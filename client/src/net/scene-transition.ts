import { gameState } from '../data/game-state';
import type { BaseWorldScene } from '../scenes/BaseWorldScene';

type SceneChangeDetail = { scene: string; spawnId: string };

function startWorldScene(scene: BaseWorldScene, detail: SceneChangeDetail, withSpell: boolean): void {
  const { scene: target, spawnId } = detail;
  if (target !== 'apartment' && target !== 'town') return;

  gameState.pendingSpawnId = spawnId ?? 'default';
  const key = target === 'town' ? 'TownScene' : 'ApartmentScene';

  if (withSpell) {
    void scene.playTeleportDeparture().finally(() => {
      scene.scene.start(key);
    });
    return;
  }

  scene.scene.start(key);
}

/** Scene-change listener — registered once on the active world scene */
export function attachSceneChangeHandler(scene: BaseWorldScene): void {
  const onDoorTravel = (e: Event): void => {
    startWorldScene(scene, (e as CustomEvent<SceneChangeDetail>).detail, false);
  };

  const onTeleportTravel = (e: Event): void => {
    startWorldScene(scene, (e as CustomEvent<SceneChangeDetail>).detail, true);
  };

  window.addEventListener('game:scene-change', onDoorTravel);
  window.addEventListener('game:teleport-scene-change', onTeleportTravel);
  scene.events.once('shutdown', () => {
    window.removeEventListener('game:scene-change', onDoorTravel);
    window.removeEventListener('game:teleport-scene-change', onTeleportTravel);
  });
}
