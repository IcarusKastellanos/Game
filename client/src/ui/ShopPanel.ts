import Phaser from 'phaser';
import { formatContentLabel } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { ambientAudio } from '../audio/AmbientAudio';

/** Shop panel — buy from data-driven shop inventory */
export class ShopPanel {
  private container!: Phaser.GameObjects.Container;
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private shopId = '';

  constructor(private scene: Phaser.Scene) {
    this.build();
    this.hide();
  }

  private build(): void {
    const bg = this.scene.add.rectangle(256, 192, 440, 320, 0x1a1a2e, 0.95).setStrokeStyle(2, 0x6688cc);
    const title = this.scene.add
      .text(256, 45, '◆ SHOP ◆', { fontSize: '12px', color: '#aaccff', fontFamily: 'monospace' })
      .setOrigin(0.5);
    const closeBtn = this.scene.add
      .text(450, 40, '[X]', { fontSize: '10px', color: '#ff6666', fontFamily: 'monospace' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.hide());

    this.container = this.scene.add.container(0, 0, [bg, title, closeBtn]);
    this.container.setDepth(2000).setScrollFactor(0);
  }

  show(shopId: string): void {
    this.shopId = shopId;
    this.container.setVisible(true);
    ambientAudio.setScene('shop');
    this.renderShop();
  }

  hide(): void {
    this.container.setVisible(false);
    this.itemTexts.forEach((t) => t.destroy());
    this.itemTexts = [];
    const scene = gameState.currentScene;
    ambientAudio.setScene(scene === 'town' ? 'town' : scene === 'apartment' ? 'apartment' : 'none');
  }

  private renderShop(): void {
    this.itemTexts.forEach((t) => t.destroy());
    this.itemTexts = [];

    const shop = gameState.content?.shops.find((s) => s.id === this.shopId);
    if (!shop) return;

    let y = 70;
    for (const item of shop.inventory.slice(0, 10)) {
      const ing = gameState.content?.ingredients.find((i) => i.id === item.itemId);
      const label = `${ing?.name ?? formatContentLabel(item.itemId)} — ${item.price}c (stock: ${item.stock}) [BUY]`;
      const txt = this.scene.add
        .text(40, y, label, {
          fontSize: '8px',
          color: '#bbddff',
          fontFamily: 'monospace',
          backgroundColor: '#223355',
          padding: { x: 3, y: 1 },
        })
        .setInteractive({ useHandCursor: true })
        .setScrollFactor(0)
        .setDepth(2001)
        .on('pointerdown', () => this.buy(item.itemId));

      this.itemTexts.push(txt);
      y += 16;
    }
  }

  private buy(itemId: string): void {
    network.send('buy_item', { shopId: this.shopId, itemId, quantity: 1 });
    setTimeout(() => this.renderShop(), 300);
  }
}
