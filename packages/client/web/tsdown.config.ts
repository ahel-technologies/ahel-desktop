import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@ahel/dsh-client-web',
  ['lib/types/index.js', 'lib/types/apply-injections.js'],
)
