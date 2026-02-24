import { MqttClient } from '../mqtt/mqtt-client';
import {
  arrayBufferToBase64,
  generateUid,
  keepOnlyCodec,
  padZero
} from '../utils/rtc-tools';
import { DEFAULT_TIMEOUT, MQTT_ICE_TOPIC, MQTT_SDP_TOPIC } from '../constants';
import { IPiCamera, IPiCameraOptions } from './pi-camera.interface';
import { CameraControlId, CameraControlValue } from './camera-property';
import { DataChannelReceiver } from './datachannel-receiver';
import {
  RTCPeerConnection,
  mediaDevices,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
} from 'react-native-webrtc';
import RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import {
  CommandType,
  DisconnectRequest,
  Packet,
  QueryFileRequest,
  QueryFileType,
  QueryFileResponse,
  RecordingResponse
} from '../proto/packet';

enum ChannelId {
  Command,
  Lossy,
  Reliable
}

export class PiCamera implements IPiCamera {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onDatachannel?: (id: number) => void;
  onSnapshot?: (base64: string) => void;
  onStream?: (stream: MediaStream | undefined) => void;
  onVideoListLoaded?: (res: QueryFileResponse) => void;
  onProgress?: (received: number, total: number, type: CommandType) => void;
  onVideoDownloaded?: (file: Uint8Array) => void;
  onMessage?: (data: Uint8Array) => void;
  onRecording?: (res: RecordingResponse) => void;
  onTimeout?: () => void;

  private options: IPiCameraOptions;
  private mqttClient?: MqttClient;
  private rtcTimer?: NodeJS.Timeout;
  private rtcPeer?: RTCPeerConnection;
  private cmdChannel?: RTCDataChannel;
  private ipcChannel?: RTCDataChannel;
  private localStream?: MediaStream;
  private remoteStream?: MediaStream;
  private pendingIceCandidates: RTCIceCandidate[] = [];

  private snapshotReceiver?: DataChannelReceiver;
  private queryFileReceiver?: DataChannelReceiver;
  private fileReceiver?: DataChannelReceiver;
  private customReceiver?: DataChannelReceiver;

  constructor(options: IPiCameraOptions) {
    this.options = this.initializeOptions(options);
  }

  connect = () => {
    this.mqttClient = new MqttClient(this.options);
    this.mqttClient.onConnect = async (conn: MqttClient) => {
      this.rtcPeer = await this.createPeer();

      conn.subscribe(MQTT_SDP_TOPIC, this.handleSdpMessage);
      conn.subscribe(MQTT_ICE_TOPIC, this.handleIceMessage);

      const offer = await this.rtcPeer.createOffer({});

      if (this.options.codec && offer.sdp) {
        offer.sdp = keepOnlyCodec(offer.sdp, this.options.codec);
      }

      this.rtcPeer?.setLocalDescription(offer);
      conn.publish(MQTT_SDP_TOPIC, JSON.stringify(offer));
    }

    this.mqttClient.connect();

    this.rtcTimer = setTimeout(() => {
      if (this.rtcPeer?.connectionState === 'connected' ||
        this.rtcPeer?.connectionState === 'closed'
      ) {
        return;
      }

      if (this.onTimeout) {
        this.onTimeout();
      }
      this.terminate();
    }, this.options.timeout);
  }

  terminate = () => {
    clearTimeout(this.rtcTimer);

    this.snapshotReceiver?.reset();
    this.queryFileReceiver?.reset();
    this.fileReceiver?.reset();
    this.customReceiver?.reset();

    if (this.cmdChannel) {
      if (this.cmdChannel.readyState === 'open') {
        const packet = Packet.create({
          type: CommandType.DISCONNECT,
          disconnectionRequest: DisconnectRequest.create()
        });
        const binary = Packet.encode(packet).finish();
        this.cmdChannel.send(binary);
      }
      this.cmdChannel.close();
      this.cmdChannel = undefined;
    }

    if (this.ipcChannel) {
      this.ipcChannel.close();
      this.ipcChannel = undefined;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => { track.stop() });
      this.localStream = undefined;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => { track.stop() });
      this.remoteStream = undefined;

      if (this.onStream) {
        this.onStream(this.remoteStream);
      }
    }

    if (this.rtcPeer) {
      this.rtcPeer.close();
      this.rtcPeer = undefined;
    }

    if (this.mqttClient) {
      this.mqttClient.disconnect();
      this.mqttClient = undefined;
    }

    if (this.onConnectionState) {
      this.onConnectionState('closed');
    }
  }

  getStatus = (): RTCPeerConnectionState => {
    if (!this.rtcPeer) {
      return 'new';
    }
    return this.rtcPeer.connectionState;
  }

  fetchVideoList(param?: string | Date): void {
    if (this.onVideoListLoaded && this.cmdChannel?.readyState === 'open') {
      let queryRequest = QueryFileRequest.create();

      if (param === undefined) {
        queryRequest.type = QueryFileType.LATEST_FILE;
      } else if (typeof param === "string") {
        queryRequest.type = QueryFileType.BEFORE_FILE;
        queryRequest.parameter = param;
      } else {
        const formattedDate = `${param.getFullYear()}${padZero(param.getMonth() + 1)}${padZero(param.getDate())}` +
          "_" + `${padZero(param.getHours())}${padZero(param.getMinutes())}${padZero(param.getSeconds())}`;
        queryRequest.type = QueryFileType.BEFORE_TIME;
        queryRequest.parameter = formattedDate;
      }

      const binary = Packet.encode(Packet.create({
        type: CommandType.QUERY_FILE,
        queryFileRequest: queryRequest
      })).finish();
      this.cmdChannel.send(binary);
    }
  }

  downloadVideoFile(path: string): void {
    if (this.onVideoDownloaded && this.cmdChannel?.readyState === 'open') {
      const command = Packet.create({
        type: CommandType.TRANSFER_FILE,
        transferFileRequest: {
          filepath: path
        }
      });
      const binary = Packet.encode(command).finish();
      this.cmdChannel.send(binary);
    }
  }

  setCameraControl = (key: CameraControlId, value: CameraControlValue) => {
    if (this.cmdChannel?.readyState === 'open') {
      const command = Packet.create({
        type: CommandType.CONTROL_CAMERA,
        controlCameraRequest: {
          id: key,
          value: value as number,
        }
      });
      const binary = Packet.encode(command).finish();
      this.cmdChannel.send(binary);
    }
  }

  snapshot = (quality: number = 30) => {
    if (this.onSnapshot && this.cmdChannel?.readyState === 'open') {
      quality = Math.max(0, Math.min(quality, 100));
      const command = Packet.create({
        type: CommandType.TAKE_SNAPSHOT,
        takeSnapshotRequest: { quality: quality }
      });
      const binary = Packet.encode(command).finish();

      this.cmdChannel.send(binary);
    }
  }

  sendText = (msg: string) => {
    this.sendData(new TextEncoder().encode(msg));
  }

  sendData = (data: Uint8Array) => {
    if (this.ipcChannel?.readyState === 'open') {
      const custom_command = Packet.create({
        type: CommandType.CUSTOM,
        customCommand: data
      });

      const binary = Packet.encode(custom_command).finish();
      this.ipcChannel.send(binary);
    }
  }

  startRecording = () => {
    if (this.cmdChannel?.readyState === 'open') {
      const command = Packet.create({ type: CommandType.START_RECORDING });
      const binary = Packet.encode(command).finish();
      this.cmdChannel.send(binary);
    }
  }

  stopRecording = () => {
    if (this.cmdChannel?.readyState === 'open') {
      const command = Packet.create({ type: CommandType.STOP_RECORDING });
      const binary = Packet.encode(command).finish();
      this.cmdChannel.send(binary);
    }
  }

  toggleMic = (enabled: boolean = !this.options.isMicOn) => {
    this.options.isMicOn = enabled;
    this.toggleTrack(this.options.isMicOn, this.localStream);
  };

  toggleSpeaker = (enabled: boolean = !this.options.isSpeakerOn) => {
    this.options.isSpeakerOn = enabled;
    this.toggleTrack(this.options.isSpeakerOn, this.remoteStream);
  };

  private toggleTrack = (isOn: boolean, stream?: MediaStream) => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = isOn;
    });
  };

  private initializeOptions(userOptions: IPiCameraOptions): IPiCameraOptions {
    const defaultOptions = {
      mqttProtocol: 'wss',
      mqttPath: '',
      timeout: DEFAULT_TIMEOUT,
      datachannelOnly: false,
      isMicOn: true,
      isSpeakerOn: true,
      credits: true,
    } as IPiCameraOptions;

    return { ...defaultOptions, ...userOptions };
  }

  private getRtcConfig = (): RTCConfiguration => {
    let config: RTCConfiguration = {};
    config.iceServers = [];
    config.iceCandidatePoolSize = 10;
    if (this.options.stunUrls && this.options.stunUrls.length > 0) {
      config.iceServers.push({ urls: this.options.stunUrls });
    }

    if (this.options.turnUrl && this.options.turnUsername && this.options.turnPassword) {
      config.iceServers.push({
        urls: this.options.turnUrl,
        username: this.options.turnUsername,
        credential: this.options.turnPassword,
      });
    }
    return config;
  }

  private createPeer = async (): Promise<RTCPeerConnection> => {
    const peer = new RTCPeerConnection(this.getRtcConfig());

    if (!this.options.datachannelOnly) {
      this.localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.localStream.getAudioTracks().forEach(track => {
        peer.addTrack(track, this.localStream!);
        track.enabled = this.options.isMicOn ?? false;
      });
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "sendrecv" });

      peer.addEventListener("track", (e) => {
        this.remoteStream = new MediaStream();
        e.streams[0].getTracks().forEach((track) => {
          this.remoteStream?.addTrack(track);
          if (track.kind === "audio") {
            track.enabled = this.options.isSpeakerOn ?? false;
          }
        });

        if (this.onStream) {
          this.onStream(this.remoteStream);
        }
      });
    }

    peer.addEventListener("icecandidate", (e) => {
      if (e.candidate && this.mqttClient?.isConnected()) {
        this.mqttClient.publish(MQTT_ICE_TOPIC, JSON.stringify(e.candidate));
      }
    });

    // Create Command data channel
    this.cmdChannel = peer.createDataChannel(generateUid(10), {
      negotiated: true,
      ordered: true,
      id: ChannelId.Command,
    });
    this.cmdChannel.binaryType = "arraybuffer";
    this.cmdChannel.addEventListener("open", () => {
      if (this.onDatachannel) {
        this.onDatachannel(ChannelId.Command);
      }
    });
    this.cmdChannel.addEventListener("message", (e: any) => this.onDataChannelMessage(e));

    // Create IPC data channel if needed
    if (this.options.ipcMode) {
      const ipcChannelId = this.options.ipcMode === 'lossy' ? ChannelId.Lossy : ChannelId.Reliable;
      const options: RTCDataChannelInit = {
        id: ipcChannelId,
        ordered: true,
        negotiated: true,
      };

      if (this.options.ipcMode === 'lossy') {
        options.maxRetransmits = 0;
      }

      this.ipcChannel = peer.createDataChannel(generateUid(10), options);
      this.ipcChannel.binaryType = "arraybuffer";
      this.ipcChannel.addEventListener("open", () => {
        if (this.onDatachannel) {
          this.onDatachannel(ipcChannelId);
        }
      });
      this.ipcChannel.addEventListener("message", (e: any) => this.onDataChannelMessage(e));
    }

    // Create receivers
    this.snapshotReceiver = new DataChannelReceiver({
      onProgress: (received, total) => this.onProgress?.(received, total, CommandType.TAKE_SNAPSHOT),
      onComplete: (body) => this.onSnapshot?.("data:image/jpeg;base64," + arrayBufferToBase64(body))
    });

    this.queryFileReceiver = new DataChannelReceiver({
      onProgress: (received, total) => this.onProgress?.(received, total, CommandType.QUERY_FILE),
      onComplete: (body) => {
        const decoded = QueryFileResponse.decode(body);
        this.onVideoListLoaded?.(decoded);
      }
    });

    this.fileReceiver = new DataChannelReceiver({
      onProgress: (received, total) => this.onProgress?.(received, total, CommandType.TRANSFER_FILE),
      onComplete: (body) => this.onVideoDownloaded?.(body)
    });

    this.customReceiver = new DataChannelReceiver({
      onProgress: (received, total) => this.onProgress?.(received, total, CommandType.CUSTOM),
      onComplete: (body) => this.onMessage?.(body)
    });

    peer.addEventListener("connectionstatechange", () => {
      if (this.onConnectionState) {
        this.onConnectionState(peer.connectionState);
      }

      if (peer.connectionState === "connected" && this.mqttClient?.isConnected()) {
        this.mqttClient.disconnect();
        this.mqttClient = undefined;
      } else if (peer.connectionState === "failed") {
        this.terminate();
      }
    });

    peer.addEventListener("icegatheringstatechange", e => {
      console.debug("peer.iceGatheringState: ", peer.iceGatheringState);

      if (peer.iceGatheringState === "complete") {
        console.debug("peer.localDescription: ", peer.localDescription);
      }
    });

    return peer;
  }


  private onDataChannelMessage = (e: { data: ArrayBuffer }) => {
    const data = new Uint8Array(e.data);
    const packet = Packet.decode(data);

    switch (packet.type) {
      case CommandType.TAKE_SNAPSHOT:
        this.snapshotReceiver?.receiveData(packet);
        break;
      case CommandType.QUERY_FILE:
        this.queryFileReceiver?.receiveData(packet);
        break;
      case CommandType.TRANSFER_FILE:
        this.fileReceiver?.receiveData(packet);
        break;
      case CommandType.START_RECORDING:
      case CommandType.STOP_RECORDING:
        if (packet.recordingResponse) {
          this.onRecording?.(packet.recordingResponse);
        }
        break;
      case CommandType.CUSTOM:
        this.customReceiver?.receiveData(packet);
        break;
    }
  }


  private handleSdpMessage = (message: string) => {
    const sdp = JSON.parse(message) as RTCSessionDescription;
    this.rtcPeer?.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  private handleIceMessage = (message: string) => {
    const ice = JSON.parse(message) as RTCIceCandidate;
    if (this.rtcPeer?.remoteDescription) {
      this.rtcPeer.addIceCandidate(new RTCIceCandidate(ice));

      while (this.pendingIceCandidates.length > 0) {
        const cacheIce = this.pendingIceCandidates.shift();
        if (cacheIce) {
          this.rtcPeer.addIceCandidate(new RTCIceCandidate(cacheIce));
        }
      }
    } else {
      this.pendingIceCandidates.push(ice);
    }
  }
}
