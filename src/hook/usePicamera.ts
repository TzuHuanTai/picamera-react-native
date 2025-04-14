import { useEffect, useRef, useState } from 'react';
import { MediaStream } from 'react-native-webrtc';
import { PiCamera } from '../rtc/pi-camera';
import { IPiCameraOptions, IPiCameraEvents } from '../rtc/pi-camera.interface';

type UseCameraPlayerProps = IPiCameraEvents & {
  options: IPiCameraOptions;
};

export const usePiCamera = ({
  options,
  ...callbacks
}: UseCameraPlayerProps) => {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const clientRef = useRef<PiCamera | null>(null);

  useEffect(() => {
    const client = new PiCamera(options);
    client.onStream = setRemoteStream;
    client.onConnectionState = callbacks.onConnectionState;
    client.onDatachannel = callbacks.onDatachannel;
    client.onMetadata = callbacks.onMetadata;
    client.onSnapshot = callbacks.onSnapshot;
    client.onTimeout = callbacks.onTimeout;
    client.onVideoDownloaded = callbacks.onVideoDownloaded;

    client.connect();
    clientRef.current = client;

    return () => {
      client.terminate();
    };
  }, []);

  return {
    remoteStream,
    client: clientRef.current,
  };
};
