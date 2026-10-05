import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-api-session-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
