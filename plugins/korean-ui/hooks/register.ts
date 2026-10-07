import type { EngineInterface, Register } from 'claude-code'
import {
  type Dictionary,
  type Kind,
  type Seen,
  type Settings,
  buildReverse,
  categoryOf,
  emptyDictionary,
  emptySeen,
  isEnabled,
  lookup,
  messageOf,
  needsTranslation,
  parseDictionary,
  readSettings,
  recordSeen,
  restoreListing,
  splitState,
  withState,
} from './lib/translation.ts'

const STORE_DICTIONARY = 'dictionary'

// 처음 필요할 때 한 번 읽어 두는 기본 번역표와 사용자 번역 사전입니다.
type Loaded = {
  bundled: Dictionary
  user: Dictionary
}

// 플러그인이 한 번 로드된 동안 유지하는 상태입니다. /config 값을 바꾸면 플러그인이 다시 로드되어 새로 만들어집니다.
type State = {
  settings: Settings
  seen: Seen
  loading: Promise<Loaded> | undefined
}

// Claude Code가 플러그인을 불러올 때 부르는 함수입니다. 화면 문구를 바꾸는 이벤트 처리를 등록합니다.
export const register: Register = (on, options) => {
  const state: State = { settings: readSettings(options), seen: emptySeen(), loading: undefined }

  // 다시 로드된 뒤에는 Claude Code가 저장해 둔 이전 표시 결과를 지워서, 바뀐 설정이 바로 반영되게 합니다.
  on('session.start', async ($, e, next) => {
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
    return next(e)
  })

  // 메뉴와 /help에 표시할 명령어 설명을 한국어로 바꿉니다.
  on('command.describe', async ($, e, next) => {
    const description = await translateText($, state, 'commands', e.provider.plugin, e.description)
    return description === undefined ? next(e) : next({ ...e, description })
  })

  // Claude에게 보내기 직전의 스킬 목록에서 번역문을 영어 원문으로 되돌립니다.
  // 번역을 끈 뒤에도 Claude Code가 이전에 만든 목록을 다시 쓰는 경우가 있으므로, 설정과 관계없이 번역 사전을 기준으로 되돌립니다.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const loaded = await ensureLoaded($, state)
    const result = restoreListing(e.text, buildReverse(loaded.bundled, loaded.user))
    if (result.leftover > 0) {
      $.ui.log(`스킬 목록을 되돌린 뒤에도 번역문 ${result.leftover}개가 남아 있습니다. 목록 형식이 바뀌었을 수 있습니다.`, {
        to: 'debug',
      })
    }
    return result.restored > 0 ? next({ ...e, text: result.text }) : next(e)
  })

  // /config에 표시할 항목 이름과 도움말을 한국어로 바꿉니다.
  on('config.describe', async ($, e, next) => {
    const label = await translateText($, state, 'config', e.provider.plugin, e.label)
    const description =
      e.description === undefined ? undefined : await translateText($, state, 'config', e.provider.plugin, e.description)
    if (label === undefined && description === undefined) return next(e)
    return next({ ...e, label: label ?? e.label, description: description ?? e.description })
  })
}

// 화면에 표시할 문구의 번역문을 찾습니다. 번역하지 않는 문구이거나 번역문이 없으면 undefined를 돌려줍니다.
async function translateText(
  $: EngineInterface,
  state: State,
  kind: Kind,
  providerPlugin: string,
  source: string,
): Promise<string | undefined> {
  const category = categoryOf(providerPlugin, $.plugin.name)
  const { base, state: current } = splitState(source)
  if (category === 'self' || !needsTranslation(base)) return undefined
  recordSeen(state.seen, kind, base, category)
  if (!isEnabled(category, state.settings)) return undefined
  const loaded = await ensureLoaded($, state)
  const translated = lookup(loaded.bundled, loaded.user, kind, base)
  return translated === undefined ? undefined : withState(translated, current)
}

// 기본 번역표와 사용자 번역 사전을 처음 한 번만 읽고, 그다음부터는 읽어 둔 값을 씁니다.
function ensureLoaded($: EngineInterface, state: State): Promise<Loaded> {
  state.loading ??= loadAll($)
  return state.loading
}

// 기본 번역표와 사용자 번역 사전을 읽습니다.
async function loadAll($: EngineInterface): Promise<Loaded> {
  return { bundled: await readBundled($), user: await readUser($) }
}

// 플러그인 폴더의 기본 번역표를 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readBundled($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(JSON.parse(await $.fs.read(`${$.plugin.root}/locales/ko.json`)))
  } catch (error) {
    $.ui.log(`기본 번역표를 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 저장소에서 사용자 번역 사전을 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readUser($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(await $.store.get(STORE_DICTIONARY))
  } catch (error) {
    $.ui.log(`사용자 번역 사전을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}
