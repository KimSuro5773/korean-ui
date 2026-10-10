// 화면에서 확인한 원문을 제공자별로 나누어 다루는 함수들입니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.
import {
  BUILTIN_PROVIDER,
  KINDS,
  MESSAGES,
  isSkipped,
  noticeKey,
  type Dictionary,
  type Failures,
  type Kind,
  type Layers,
  type Seen,
  type Settings,
} from './translation.ts'

// 종류별 원문 목록입니다. 제공자 하나가 쓰는 원문을 가리킬 때 씁니다.
export type SourceSet = Readonly<Record<Kind, readonly string[]>>

// 화면에서 확인한 제공자의 이름을 돌려줍니다. Claude Code를 먼저 두고, 나머지는 이름순으로 둡니다.
export function providersOf(seen: Seen): string[] {
  const names = new Set<string>()
  for (const kind of KINDS) {
    for (const entry of seen[kind].values()) {
      for (const provider of entry.providers) names.add(provider)
    }
  }
  const others = [...names].filter((name) => name !== BUILTIN_PROVIDER).sort()
  return names.has(BUILTIN_PROVIDER) ? [BUILTIN_PROVIDER, ...others] : others
}

// 사용자가 입력한 이름과 일치하는 제공자를 찾습니다. 앞뒤 공백과 '@마켓플레이스'를 떼고, 대소문자를 구분하지 않고 비교합니다.
export function matchProvider(seen: Seen, argument: string): string | undefined {
  const trimmed = argument.trim()
  const at = trimmed.indexOf('@')
  const wanted = (at === -1 ? trimmed : trimmed.slice(0, at)).toLowerCase()
  return providersOf(seen).find((name) => name.toLowerCase() === wanted)
}

// 그 제공자가 쓰는 원문을 종류별로 정렬해서 돌려줍니다.
export function sourcesOf(seen: Seen, provider: string): Record<Kind, string[]> {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  for (const kind of KINDS) {
    for (const [source, entry] of seen[kind]) {
      if (entry.providers.has(provider)) result[kind].push(source)
    }
    result[kind].sort()
  }
  return result
}

// 종류별 원문 목록에서 only에 들어 있는 원문만 남깁니다.
export function restrictTo(sources: SourceSet, only: SourceSet): Record<Kind, string[]> {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  for (const kind of KINDS) {
    const wanted = new Set(only[kind])
    result[kind] = sources[kind].filter((source) => wanted.has(source))
  }
  return result
}

// 사전에 그 원문들의 번역문이 몇 개 있는지 셉니다.
export function countStored(dictionary: Dictionary, sources: SourceSet): number {
  return KINDS.reduce((sum, kind) => sum + sources[kind].filter((source) => Object.hasOwn(dictionary[kind], source)).length, 0)
}

// 사전에서 그 원문들의 번역문을 뺀 사본을 만듭니다. 원래 사전은 바꾸지 않습니다.
export function withoutSources(dictionary: Dictionary, sources: SourceSet): Dictionary {
  const next: Dictionary = { commands: { ...dictionary.commands }, config: { ...dictionary.config } }
  for (const kind of KINDS) {
    for (const source of sources[kind]) delete next[kind][source]
  }
  return next
}

// 그 원문들 중 3번 이상 실패해서 건너뛰는 원문의 수를 셉니다.
export function countSkipped(failures: Failures | undefined, sources: SourceSet): number {
  return KINDS.reduce((sum, kind) => sum + sources[kind].filter((source) => isSkipped(failures, kind, source)).length, 0)
}

// 실패 기록에 그 원문들의 횟수가 하나라도 있는지 확인합니다.
export function hasFailures(failures: Failures, sources: SourceSet): boolean {
  return KINDS.some((kind) => sources[kind].some((source) => failures.counts[noticeKey(kind, source)] !== undefined))
}

// 실패 기록에서 그 원문들의 횟수를 뺀 사본을 만듭니다. 원래 기록은 바꾸지 않습니다.
export function withoutFailures(failures: Failures, sources: SourceSet): Failures {
  const counts = { ...failures.counts }
  for (const kind of KINDS) {
    for (const source of sources[kind]) delete counts[noticeKey(kind, source)]
  }
  return { version: failures.version, counts }
}

// 원문 하나의 번역 상태입니다. override는 고친 번역, bundled는 기본 번역표, auto는 자동 번역이 표시되는 원문입니다.
// skipped는 번역문이 없고 3번 이상 실패해서 건너뛰는 원문, untranslated는 그 밖의 번역문이 없는 원문입니다.
export type SourceState = 'override' | 'bundled' | 'auto' | 'skipped' | 'untranslated'

// 원문 하나의 번역 상태를 번역문을 찾는 순서대로 판정합니다.
export function stateOf(layers: Layers, failures: Failures | undefined, kind: Kind, source: string): SourceState {
  if (Object.hasOwn(layers.overrides[kind], source)) return 'override'
  if (Object.hasOwn(layers.bundled[kind], source)) return 'bundled'
  if (Object.hasOwn(layers.user[kind], source)) return 'auto'
  return isSkipped(failures, kind, source) ? 'skipped' : 'untranslated'
}

// 제공자 하나의 번역 현황입니다. total은 그 제공자가 쓰는 원문의 수이고, 나머지는 번역 상태별 원문의 수입니다.
export type ProviderRow = { provider: string; total: number } & Record<SourceState, number>

// 제공자별 번역 현황을 providersOf와 같은 순서로 만듭니다. 여러 제공자가 쓰는 원문은 각 제공자에 모두 셉니다.
export function providerRows(seen: Seen, layers: Layers, failures: Failures | undefined): ProviderRow[] {
  const rows = new Map<string, ProviderRow>()
  for (const provider of providersOf(seen)) {
    rows.set(provider, { provider, total: 0, override: 0, bundled: 0, auto: 0, skipped: 0, untranslated: 0 })
  }
  for (const kind of KINDS) {
    for (const [source, entry] of seen[kind]) {
      const state = stateOf(layers, failures, kind, source)
      for (const provider of entry.providers) {
        const row = rows.get(provider)
        if (row === undefined) continue
        row.total += 1
        row[state] += 1
      }
    }
  }
  return [...rows.values()]
}

// 자동 번역이나 고친 번역에 저장되어 있지만 이번 세션에서 확인하지 못한 원문의 수를 셉니다.
// 두 사전에 모두 있는 원문은 한 번만 셉니다.
export function unseenStored(seen: Seen, layers: Layers): number {
  let count = 0
  for (const kind of KINDS) {
    const stored = new Set([...Object.keys(layers.user[kind]), ...Object.keys(layers.overrides[kind])])
    for (const source of stored) {
      if (!seen[kind].has(source)) count += 1
    }
  }
  return count
}

// /korean-ui-status가 보여 줄 글을 만듭니다. 버전과 설정, 제공자별 번역 현황 표, 확인하지 못한 저장 번역의 수를 차례로 담습니다.
// 확인한 문구가 없으면 표 대신 안내를 넣고, 확인하지 못한 저장 번역이 없으면 그 줄을 넣지 않습니다.
export function statusText(
  version: string | undefined,
  settings: Settings,
  rows: readonly ProviderRow[],
  unseen: number,
): string {
  const lines = [MESSAGES.statusVersion(version), MESSAGES.statusSettings(settings), '']
  if (rows.length === 0) {
    lines.push(MESSAGES.statusNothingSeen)
  } else {
    lines.push(`| ${MESSAGES.statusColumns.join(' | ')} |`, `|${MESSAGES.statusColumns.map(() => '---').join('|')}|`)
    for (const row of rows) {
      const cells = [row.provider, row.total, row.bundled, row.auto, row.override, row.untranslated, row.skipped]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  if (unseen > 0) lines.push('', MESSAGES.statusUnseen(unseen))
  return lines.join('\n')
}
