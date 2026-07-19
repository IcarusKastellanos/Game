import navBag from '../../assets/hud/sprites/nav_bag.png';
import navGrimoire from '../../assets/hud/sprites/nav_grimoire.png';
import navSpells from '../../assets/hud/sprites/nav_spells.png';
import navSocial from '../../assets/hud/sprites/nav_social.png';
import navCoven from '../../assets/hud/sprites/nav_coven.png';
import navTeleport from '../../assets/hud/sprites/nav_teleport.png';
import navMap from '../../assets/hud/sprites/nav_map.png';
import navSettings from '../../assets/hud/sprites/nav_settings.png';

import intuitionMeter from '../../assets/hud/sprites/intuition_gem_crust.png';
import intuitionEye from '../../assets/hud/sprites/intuition_eye.png';
import intuitionGlowDormant from '../../assets/hud/sprites/intuition_glow_dormant.png';
import intuitionGlowFaint from '../../assets/hud/sprites/intuition_glow_faint.png';
import intuitionGlowAware from '../../assets/hud/sprites/intuition_glow_aware.png';
import intuitionGlowStrong from '../../assets/hud/sprites/intuition_glow_strong.png';
import intuitionGlowOverwhelming from '../../assets/hud/sprites/intuition_glow_overwhelming.png';

import portraitFrame from '../../assets/hud/sprites/portrait_frame.png';
import barTrackHealth from '../../assets/hud/sprites/bar_track_health.png';
import barTrackEnergy from '../../assets/hud/sprites/bar_track_magical_energy.png';
import barTrackXp from '../../assets/hud/sprites/bar_track_experience.png';
import symbolHealth from '../../assets/hud/sprites/symbol_health.png';
import symbolEnergy from '../../assets/hud/sprites/symbol_magnetic_energy.png';
import symbolXp from '../../assets/hud/sprites/symbol_experience.png';

import hotbarFrame from '../../assets/hud/sprites/hotbar_frame.png';

import resourceCoin from '../../assets/hud/sprites/resource_coin.png';
import resourceEssence from '../../assets/hud/sprites/resource_essence.png';
import resourceFavor from '../../assets/hud/sprites/resource_favor.png';
import resourceReputation from '../../assets/hud/sprites/reputation_counter.png';
import moralityGauge from '../../assets/hud/sprites/morality_gauge.png';
import moralitySlider from '../../assets/hud/sprites/morality_slider.png';

export const hudSprites = {
  nav: {
    bag: navBag,
    grimoire: navGrimoire,
    spells: navSpells,
    social: navSocial,
    coven: navCoven,
    teleport: navTeleport,
    map: navMap,
    settings: navSettings,
  },
  intuition: {
    meter: intuitionMeter,
    eye: intuitionEye,
    glow: {
      dormant: intuitionGlowDormant,
      faint: intuitionGlowFaint,
      aware: intuitionGlowAware,
      strong: intuitionGlowStrong,
      overwhelming: intuitionGlowOverwhelming,
    },
  },
  player: {
    frame: portraitFrame,
    moralityGauge,
    moralitySlider,
    bars: {
      health: barTrackHealth,
      energy: barTrackEnergy,
      xp: barTrackXp,
    },
    symbols: {
      health: symbolHealth,
      energy: symbolEnergy,
      xp: symbolXp,
    },
  },
  hotbar: {
    frame: hotbarFrame,
  },
  resources: {
    coin: resourceCoin,
    essence: resourceEssence,
    favor: resourceFavor,
    reputation: resourceReputation,
  },
} as const;

export type IntuitionGlowState = keyof typeof hudSprites.intuition.glow;
