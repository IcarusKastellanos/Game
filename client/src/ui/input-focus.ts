import Phaser from 'phaser';

import { gameState } from '../data/game-state';



let focusCount = 0;

let phaserGame: Phaser.Game | null = null;



function isTextInput(el: EventTarget | null): el is HTMLElement {

  if (!el || !(el instanceof HTMLElement)) return false;

  const tag = el.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  return el.isContentEditable;

}



function keyboardManager(): Phaser.Input.Keyboard.KeyboardManager | null {

  return phaserGame?.input?.keyboard ?? null;

}



/** True while the player is typing in a DOM input (blocks game hotkeys/movement) */

export function isDomInputFocused(): boolean {

  return gameState.domInputFocused;

}



/** Block game hotkeys when any text field has focus (fallback if focusin missed) */

export function shouldBlockGameHotkeys(): boolean {

  if (gameState.domInputFocused) return true;

  return isTextInput(document.activeElement);

}



function setGameKeyboardForTyping(typing: boolean): void {

  const km = keyboardManager();

  if (km) {

    // Global manager runs before DOM inputs — must turn off preventDefault while typing

    km.preventDefault = typing ? false : km.captures.length > 0;

  }



  if (!phaserGame) return;

  for (const scene of phaserGame.scene.scenes) {

    const kb = scene.input?.keyboard;

    if (kb) kb.enabled = !typing;

  }



  if (typing) {

    const canvas = phaserGame.canvas;

    if (canvas && document.activeElement === canvas) {

      canvas.blur();

    }

  }

}



function onTextFocusIn(): void {

  focusCount++;

  gameState.domInputFocused = true;

  setGameKeyboardForTyping(true);

}



function onTextFocusOut(): void {

  focusCount = Math.max(0, focusCount - 1);

  if (focusCount === 0) {

    gameState.domInputFocused = false;

    setGameKeyboardForTyping(false);

  }

}



let globalGuardReady = false;



function initGlobalInputGuard(): void {

  if (globalGuardReady) return;

  globalGuardReady = true;



  document.addEventListener(

    'focusin',

    (e) => {

      if (isTextInput(e.target)) onTextFocusIn();

    },

    true

  );



  document.addEventListener(

    'focusout',

    (e) => {

      if (isTextInput(e.target)) onTextFocusOut();

    },

    true

  );

}



/** Register once from main.ts so we can disable Phaser keyboard while typing */

export function registerPhaserGame(game: Phaser.Game): void {

  phaserGame = game;

  initGlobalInputGuard();



  game.events.once(Phaser.Core.Events.READY, () => {

    const km = keyboardManager();

    if (!km) return;

    // Drop stale captures (e.g. from HMR / old createCursorKeys) so WASD/space reach inputs

    km.clearCaptures();

    km.preventDefault = false;

    game.input.mouse?.disableContextMenu();

    game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  });

}



export function bindDomInput(el: HTMLElement): void {

  if (el.dataset.inputBound === '1') return;

  el.dataset.inputBound = '1';



  el.addEventListener('keydown', (e) => e.stopPropagation());

  el.addEventListener('keyup', (e) => e.stopPropagation());



  el.addEventListener('mousedown', (e) => {

    e.stopPropagation();

    if (document.activeElement !== el) {

      (el as HTMLInputElement).focus();

    }

  });

}



/** Bind all inputs under a container (call after innerHTML renders) */

export function bindDomInputs(root: ParentNode): void {

  root.querySelectorAll('input, textarea, select').forEach((el) => {

    bindDomInput(el as HTMLElement);

  });

}


