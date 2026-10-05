import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
