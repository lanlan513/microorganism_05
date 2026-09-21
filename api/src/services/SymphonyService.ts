import microbesData from '../data/microbesData.json' with { type: 'json' };
import { buildSymphony, MAX_VOICES, SCHEMA_VERSION } from '../../../shared/derive.js';
import type { Microbe } from '../../../shared/types.js';
import type { SonificationTraits, SymphonyPlan } from '../../../shared/symphony.js';

const microbes = microbesData as Microbe[];
const byId = new Map(microbes.map((m) => [m.id, m]));

export class InvalidSelectionError extends Error {
  status = 400;
}

function toTraits(m: Microbe): SonificationTraits {
  return {
    sizeUm: m.sizeUm,
    tempC: m.tempC,
    metabolism: m.metabolism,
    pathogenicity: m.pathogenicity,
    pathogenicityNote: m.pathogenicityNote,
  };
}

export class SymphonyService {
  static readonly schemaVersion = SCHEMA_VERSION;

  /** 按选择顺序取标本（重复自动去重，最多 MAX_VOICES 条），返回确定性总谱 */
  static buildPlan(ids: number[]): { plan: SymphonyPlan; microbes: Microbe[] } {
    const ordered: number[] = [];
    for (const raw of ids) {
      if (!Number.isInteger(raw) || !byId.has(raw)) {
        throw new InvalidSelectionError(`标本 #${raw} 不存在`);
      }
      if (!ordered.includes(raw)) ordered.push(raw);
      if (ordered.length >= MAX_VOICES) break;
    }
    if (ordered.length === 0) throw new InvalidSelectionError('请至少选择一条标本');

    const picked = ordered.map((id) => byId.get(id)!);
    const plan = buildSymphony(
      picked.map((m) => ({ id: m.id, category: m.category, traits: toTraits(m) })),
    );
    return { plan, microbes: picked };
  }

  static getMicrobes(ids: number[]): Microbe[] {
    return ids.map((id) => byId.get(id)).filter((m): m is Microbe => Boolean(m));
  }

  /**
   * 分享 token：schema 版本 + 标本 id 列表（按选择顺序）。
   * 不携带任何声音参数——参数永远由服务端重新推导，
   * 因此升级推导规则后旧链接也会听到新版本，且无法被客户端篡改。
   */
  static encodeToken(ids: number[]): string {
    const payload = { v: SCHEMA_VERSION, ids };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  static decodeToken(token: string): number[] {
    let parsed: { v?: number; ids?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    } catch {
      throw new InvalidSelectionError('分享链接无效');
    }
    if (!Array.isArray(parsed.ids) || parsed.ids.some((id) => !Number.isInteger(id))) {
      throw new InvalidSelectionError('分享链接无效');
    }
    return parsed.ids as number[];
  }
}
