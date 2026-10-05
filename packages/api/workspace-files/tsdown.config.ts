import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-api-workspace-files',
  ['lib/types/index.js'],
  { hostPhase: true },
)
