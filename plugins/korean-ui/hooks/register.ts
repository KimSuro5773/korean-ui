import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    // 다시 로드된 뒤에는 Claude Code가 저장해 둔 이전 표시 결과를 지워서, 바뀐 설정이 바로 반영되게 합니다.
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
    return next(e)
  })
}
