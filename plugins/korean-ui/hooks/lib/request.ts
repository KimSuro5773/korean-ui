// 자유 요청(/korean-ui-translate <요청>)의 대상을 고르고 결과를 보여 주는 데 쓰는 함수들입니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.
import {
  CONTEXT_LIMIT,
  KINDS,
  isEnabled,
  lookup,
  parseReply,
  type Kind,
  type Layers,
  type Seen,
  type Settings,
} from './translation.ts'

// 요청의 대상이 될 수 있는 원문 하나입니다. current는 지금 표시 중인 번역문이고, 번역문이 없으면 넣지 않습니다.
export type Candidate = {
  kind: Kind
  source: string
  names: readonly string[]
  providers: readonly string[]
  current?: string
}

// /config에서 번역하도록 켜 둔 범주의 모든 원문을 후보로 만듭니다. 번역 상태와 관계없이 모두 넣습니다.
// 명령어 설명을 먼저, /config 항목을 다음에 두고, 종류 안에서는 원문순으로 둡니다.
export function candidatesOf(seen: Seen, settings: Settings, layers: Layers): Candidate[] {
  const result: Candidate[] = []
  for (const kind of KINDS) {
    const enabled = [...seen[kind]].filter(([, entry]) => isEnabled(entry.category, settings))
    enabled.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [source, entry] of enabled) {
      const current = lookup(layers, kind, source)
      result.push({
        kind,
        source,
        names: [...entry.names],
        providers: [...entry.providers],
        ...(current === undefined ? {} : { current }),
      })
    }
  }
  return result
}

// 선택 호출 한 번에 보내는 후보의 수입니다.
export const SELECT_CHUNK = 200

// 후보를 선택 호출 한 번에 보낼 크기로 나눕니다.
export function selectionChunks(candidates: readonly Candidate[], size = SELECT_CHUNK): Candidate[][] {
  const chunks: Candidate[][] = []
  for (let start = 0; start < candidates.length; start += size) chunks.push(candidates.slice(start, start + size))
  return chunks
}

// 선택 호출에서 Haiku에게 주는 지시문입니다. 요청이 가리키는 항목만 고르게 하고, 응답 형식을 정합니다.
export const SELECTION_GUIDE = [
  '당신은 Claude Code 화면 문구의 번역을 관리하는 도구입니다. 사용자의 요청과 문구 목록을 받아서, 요청이 가리키는 항목을 고릅니다.',
  '',
  '- 요청이 대상을 한정하면(명령어 이름, 플러그인 이름, 주제, 번역문의 조건 등) 그에 맞는 항목만 고릅니다.',
  '- 요청이 대상을 한정하지 않고 번역 방식만 말하면 status가 "미번역"인 항목만 고릅니다.',
  '- status가 "번역됨"인 항목은 요청이 고치거나 다시 번역하라는 뜻일 때만 고릅니다.',
  '- 해당하는 항목이 없으면 빈 목록을 돌려줍니다.',
  '- 응답에는 {"targets": ["1", "5"]} 형식의 JSON 객체 하나만 출력합니다. 다른 설명은 쓰지 않습니다.',
].join('\n')

// 선택 호출에 보낼 요청문을 만듭니다. 요청 문장 다음에 후보를 한 줄에 하나씩 JSON으로 담고, 번호를 id로 붙입니다.
// 번역문이 있는 후보에는 지금 번역문을 current로 함께 보내서, 번역문의 조건으로 고르는 요청도 처리할 수 있게 합니다.
export function buildSelectionPrompt(request: string, chunk: readonly Candidate[]): string {
  const items = chunk.map((candidate, index) =>
    JSON.stringify({
      id: String(index + 1),
      kind: candidate.kind === 'commands' ? '명령어' : '설정',
      name: candidate.names.slice(0, CONTEXT_LIMIT).join(', '),
      plugin: candidate.providers.slice(0, CONTEXT_LIMIT).join(', '),
      text: candidate.source,
      status: candidate.current === undefined ? '미번역' : '번역됨',
      ...(candidate.current === undefined ? {} : { current: candidate.current }),
    }),
  )
  return [`사용자 요청: ${request}`, '', '문구 목록:', ...items].join('\n')
}

// 선택 응답의 id 하나를 번호로 바꿉니다. 숫자이거나 숫자로만 된 문자열이 아니면 undefined를 돌려줍니다.
function idOf(target: unknown): number | undefined {
  if (typeof target === 'number') return target
  if (typeof target === 'string' && /^\d+$/.test(target.trim())) return Number(target.trim())
  return undefined
}

// 선택 응답에서 고른 후보를 꺼냅니다. 응답을 읽을 수 없으면 undefined를 돌려줍니다.
// 보낸 목록에 없는 id는 무시하고, 같은 id가 여러 번 와도 한 번만 고르며, 결과는 보낸 목록의 순서를 따릅니다.
export function parseSelection(chunk: readonly Candidate[], replyText: string): Candidate[] | undefined {
  const targets = parseReply(replyText)?.['targets']
  if (!Array.isArray(targets)) return undefined
  const picked = new Set<number>()
  for (const target of targets) {
    const id = idOf(target)
    if (id !== undefined && Number.isInteger(id) && id >= 1 && id <= chunk.length) picked.add(id)
  }
  return chunk.filter((_, index) => picked.has(index + 1))
}

const NAME_LENGTH = 30

// 후보를 사용자에게 보여 줄 때 쓰는 이름입니다. 첫 이름을 쓰고, 이름이 없으면 원문의 앞부분을 씁니다.
export function displayName(candidate: Candidate): string {
  return candidate.names[0] ?? candidate.source.slice(0, NAME_LENGTH)
}

const NAME_PREVIEW = 5

// 기존 번역을 바꾸기 전에 사용자에게 확인받는 질문을 만듭니다. 다시 번역할 기존 번역의 수, 새로 번역할 미번역 문구의 수,
// 대상 이름을 앞에서부터 5개까지 보여 줍니다.
export function confirmQuestion(targets: readonly Candidate[]): string {
  const revised = targets.filter((target) => target.current !== undefined).length
  const fresh = targets.length - revised
  const shown = targets.slice(0, NAME_PREVIEW).map(displayName).join(', ')
  const names = targets.length > NAME_PREVIEW ? `${shown} 외 ${targets.length - NAME_PREVIEW}개` : shown
  if (fresh === 0) return `기존 번역 ${revised}개를 다시 번역합니다: ${names}. 진행할까요?`
  return `기존 번역 ${revised}개를 다시 번역하고, 미번역 문구 ${fresh}개를 번역합니다: ${names}. 진행할까요?`
}

// 요청으로 바뀐 문구 하나입니다. before는 바꾸기 전의 번역문이고, 번역문이 없던 문구이면 넣지 않습니다.
export type Change = { name: string; before?: string; after: string }

const CHANGE_PREVIEW = 20

// 자유 요청의 실행 결과를 보여 줄 글을 만듭니다. 첫 줄에 번역한 수, 번역문이 그대로여서 저장하지 않은 수, 실패한 수를 알리고,
// 그 아래에 바뀐 문구를 20줄까지 '이름: 이전 → 이후'(새로 번역한 문구는 '이름: 번역문')로 보여 줍니다.
export function requestResultText(
  counts: Readonly<Record<Kind, number>>,
  changes: readonly Change[],
  unchanged: number,
  failed: number,
): string {
  let head = `요청에 따라 명령어 설명 ${counts.commands}개, 설정 항목 ${counts.config}개를 번역했습니다.`
  if (unchanged > 0) head += ` 번역문이 그대로인 문구 ${unchanged}개는 저장하지 않았습니다.`
  if (failed > 0) head += ` 실패한 ${failed}개는 바꾸지 않았습니다.`
  const lines = changes
    .slice(0, CHANGE_PREVIEW)
    .map((change) =>
      change.before === undefined ? `- ${change.name}: ${change.after}` : `- ${change.name}: ${change.before} → ${change.after}`,
    )
  if (changes.length > CHANGE_PREVIEW) lines.push(`- 외 ${changes.length - CHANGE_PREVIEW}개`)
  return [head, ...lines].join('\n')
}
