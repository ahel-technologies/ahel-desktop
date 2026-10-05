import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-api-terminal-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
