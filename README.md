<p align=center>
    <img src="doc/icon.png" width="200" alt="picamera-react-native">
</p>
<h1 align="center">
    picamera-react-native
</h1>

# Installation

```shell
npm install picamera-react-native react-native-webrtc paho-mqtt
```

# Example
```tsx
import { useEffect, useRef, useState } from 'react';
import { RTCView, MediaStream } from 'react-native-webrtc';
import { PiCamera } from 'picamera-react-native';

export default function LiveScreen() {
  const rtcViewRef = useRef(null);
  const piCameraRef = useRef<PiCamera>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const [peerStatus, setPeerStatus] = useState<RTCPeerConnectionState>("closed");

  useEffect(() => {
    startCall();
    return endCall;
  }, []);

  const startCall = () => {
    const client = new PiCamera({
      deviceUid: 'your-custom-uid',
      mqttHost: 'your.mqtt.cloud',
      mqttPath: '/mqtt',
      mqttPort: '8884', // Websocket Port
      mqttUsername: 'hakunamatata',
      mqttPassword: 'Wonderful',
      stunUrls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"]
    });

    client.onTimeout = endCall;
    client.onStream = setRemoteStream;
    client.onSnapshot = handleImage;
    client.onConnectionState = setPeerStatus;
    client.connect();

    piCameraRef.current = client;
  }

  const endCall = () => {
    if (piCameraRef.current) {
      piCameraRef.current.terminate();
      piCameraRef.current = undefined;
    }
  }

  const handleImage = (base64: string) => {
    // receive a base64 image to do something
  };

  return (
    <>
      <RTCView
        ref={rtcViewRef}
        collapsable={false}
        streamURL={remoteStream && remoteStream.toURL()}
        objectFit={"contain"}
      />
    </>
  );
}
```
