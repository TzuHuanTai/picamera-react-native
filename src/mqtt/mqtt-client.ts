import { Client as MqttLibClient, Message } from 'paho-mqtt';
import { generateUid } from '../utils/rtc-tools';
import { IMqttConnectionOptions } from './mqtt-client.interface';

export class MqttClient {
  private options: IMqttConnectionOptions;
  private clientId: string;
  private client?: MqttLibClient;
  private subscribedFnMap: Map<string, (...args: any[]) => void>;

  public onConnect?: (conn: MqttClient) => void;

  constructor(options: IMqttConnectionOptions) {
    this.options = options;
    this.subscribedFnMap = new Map();
    this.clientId = generateUid(23);
  }

  connect = () => {
    this.client = new MqttLibClient(
      this.options.mqttHost,
      this.options.mqttPort,
      this.options.mqttPath,
      this.clientId
    );

    this.client.onMessageArrived = (message) => {
      this.handleMessage(message.destinationName, message.payloadString);
    };

    this.client.onConnectionLost = (responseObject) => {
      if (responseObject.errorCode !== 0) {
        console.log(`MQTT(${this.clientId}) onConnectionLost: ${responseObject.errorMessage}`);
      } else {
        console.log(`MQTT(${this.clientId}) disconnected`);
      }
    };

    this.client.connect({
      onSuccess: () => this.onConnect?.(this),
      userName: this.options.mqttUsername,
      password: this.options.mqttPassword,
      useSSL: this.options.mqttProtocol === 'wss',
      keepAliveInterval: 20,
      cleanSession: true,

    });
  }

  private handleMessage(topic: string, message: string) {
    console.debug(`Received message on topic: ${topic} -> ${message}`);
    const callback = this.subscribedFnMap.get(topic);
    callback?.(message);
  }

  subscribe = (topic: string, callback: (...args: any[]) => void) => {
    if (!this.client) {
      console.warn("Subscribe failed: client is undefined.");
      return;
    }

    const fullTopic = this.constructTopic(topic);
    this.client.subscribe(fullTopic, { qos: 2 });
    this.subscribedFnMap.set(fullTopic, callback);
  }

  unsubscribe = (topic: string) => {
    if (!this.client) {
      console.warn("Unsubscribe failed: client is undefined.");
      return;
    }

    const fullTopic = this.constructTopic(topic);
    this.client.unsubscribe(fullTopic);
    this.subscribedFnMap.delete(fullTopic);
  }

  publish = (topic: string, message: string) => {
    if (!this.client) {
      console.warn("Publish failed: client is undefined.");
      return;
    }

    const msg = new Message(message);
    msg.destinationName = `${this.constructTopic(topic)}/offer`;
    this.client.send(msg);
  }

  disconnect = () => {
    if (!this.client) return;

    if (this.isConnected()) {
      this.client.disconnect();
    }
    this.subscribedFnMap.clear();
  }

  isConnected = (): boolean => this.client?.isConnected() ?? false;

  private constructTopic(topic: string): string {
    return `${this.options.deviceUid}/${topic}/${this.clientId}`;
  }
}
