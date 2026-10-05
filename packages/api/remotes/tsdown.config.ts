import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)
