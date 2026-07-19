import { BaseWorldScene } from './BaseWorldScene';
import { attachSceneChangeHandler } from '../net/scene-transition';

/** Hollow Creek town — shops, NPCs, social spaces */
export class TownScene extends BaseWorldScene {
  constructor() {
    super({ key: 'TownScene' });
    this.sceneId = 'town';
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2a4a2a');

    attachSceneChangeHandler(this);
    void this.setupWorld();
  }
}
