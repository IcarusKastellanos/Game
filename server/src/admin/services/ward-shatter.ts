import { prisma } from '../../services/db.js';
import { deactivateWard } from '../../services/player-service.js';
import { shatterWardInLiveRooms } from '../../rooms/game-room-registry.js';

export async function adminShatterWard(
  wardId: string,
  adminName: string,
  reason?: string
): Promise<{ ok: true; live: boolean }> {
  const ward = await prisma.ward.findUnique({ where: { id: wardId } });
  if (!ward) throw new Error('Ward not found');
  if (!ward.active) throw new Error('Ward is already inactive');

  const live = shatterWardInLiveRooms(wardId, adminName);
  if (!live) {
    await deactivateWard(wardId);
  }

  return { ok: true, live };
}
