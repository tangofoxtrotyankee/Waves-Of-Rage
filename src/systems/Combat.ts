import Phaser from 'phaser';

import type { Obstacle } from '../entities/Obstacle';
import { PLAYER_ATTACK, PLAYER_BARGE, type Player } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';

export interface KnockoutEvent {
  rival: RivalSurfer;
  /** True when a hazard finished them off rather than the player's blow. */
  environmental: boolean;
}

export interface CombatListener {
  /** A punch or barge connected with a rival (knockout or not). */
  onRivalHit(rival: RivalSurfer): void;
  onKnockout(event: KnockoutEvent): void;
}

/**
 * Resolves player attacks against rivals and rivals against hazards.
 *
 * Stateless apart from remembering which rivals the current swing has already
 * hit, so one attack never lands twice on the same rival.
 */
export class Combat {
  private hitThisSwing = new Set<RivalSurfer>();
  private wasSwinging = false;

  constructor(private readonly listener: CombatListener) {}

  update(player: Player, obstacles: Obstacle[]): void {
    const rivals = obstacles.filter((o): o is RivalSurfer => o instanceof RivalSurfer);
    this.resolvePlayerAttacks(player, rivals);
    this.resolveEnvironmentalKnockouts(rivals, obstacles);
  }

  private resolvePlayerAttacks(player: Player, rivals: RivalSurfer[]): void {
    const box = player.attackHitBox;
    const swinging = box !== null;
    if (swinging && !this.wasSwinging) this.hitThisSwing.clear();
    this.wasSwinging = swinging;
    if (!box) return;

    const spec = player.isBarging ? PLAYER_BARGE : PLAYER_ATTACK;
    for (const rival of rivals) {
      if (!rival.isAlive || this.hitThisSwing.has(rival)) continue;
      if (!Phaser.Geom.Rectangle.Overlaps(box, rival.hitBox)) continue;

      this.hitThisSwing.add(rival);
      const knockedOut = rival.takeHit(spec.damage, player.facing, spec.knockback);
      this.listener.onRivalHit(rival);
      if (knockedOut) this.listener.onKnockout({ rival, environmental: false });
    }
  }

  /** A rival still sliding from a player hit that touches a lethal hazard wipes out. */
  private resolveEnvironmentalKnockouts(rivals: RivalSurfer[], obstacles: Obstacle[]): void {
    for (const rival of rivals) {
      if (!rival.isKnocked) continue;
      const box = rival.hitBox;
      for (const hazard of obstacles) {
        if (hazard === rival || !hazard.knocksOutRivals || !hazard.active) continue;
        if (!Phaser.Geom.Rectangle.Overlaps(box, hazard.hitBox)) continue;
        rival.wipeOut(Math.sign(rival.x - hazard.x) || 1);
        this.listener.onKnockout({ rival, environmental: true });
        break;
      }
    }
  }
}
