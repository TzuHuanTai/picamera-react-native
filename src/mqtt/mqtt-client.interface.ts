export interface IMqttConnectionOptions {
  deviceUid: string;
  mqttHost: string;
  mqttPath: string;
  mqttPort: number;
  mqttProtocol?: 'wss' | 'ws';
  mqttUsername: string;
  mqttPassword: string;
}
