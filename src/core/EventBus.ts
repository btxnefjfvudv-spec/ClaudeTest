import Phaser from 'phaser';

/** App-wide event bus for cross-system messages (score, audio, flow). */
export const EventBus = new Phaser.Events.EventEmitter();
