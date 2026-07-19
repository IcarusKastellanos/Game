import { BaseWorldScene } from './BaseWorldScene';
import { attachSceneChangeHandler } from '../net/scene-transition';
import { ApartmentWardOverlay } from '../graphics/ApartmentWardOverlay';
import { gameState } from '../data/game-state';

/** Player apartment — altar, familiar home base */
export class ApartmentScene extends BaseWorldScene {
  private wardOverlay?: ApartmentWardOverlay;

  constructor() {
    super({ key: 'ApartmentScene' });
    this.sceneId = 'apartment';
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#3d2817');

    attachSceneChangeHandler(this);
    window.addEventListener('game:map-layout-rebuilt', this.onMapLayoutRebuilt as EventListener);
    void this.setupWorld().then(() => {
      const mapDef = gameState.getMap('apartment');
      if (mapDef) this.wardOverlay = new ApartmentWardOverlay(this, mapDef);
    });
  }

  shutdown(): void {
    this.wardOverlay?.destroy();
    window.removeEventListener('game:map-layout-rebuilt', this.onMapLayoutRebuilt as EventListener);
    super.shutdown();
  }

  private onMapLayoutRebuilt = (e: Event): void => {
    const { sceneId } = (e as CustomEvent<{ sceneId: string }>).detail;
    if (sceneId !== 'apartment') return;
    const mapDef = gameState.getMap('apartment');
    if (!mapDef) return;
    this.wardOverlay?.destroy();
    this.wardOverlay = new ApartmentWardOverlay(this, mapDef);
  };
}
