import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@ahel/dsh-client-ui-theme',
  ['lib/types/index.js'],
  {
    lib: {
      copy: [{
        from: 'src/styles/{brand-font.css,ahel-font.css,montserrat-*.woff2,dm-sans-*.woff2,dm-mono-*.woff2,outfit-*.woff2,*-OFL.txt}',
        to: 'lib/styles',
      }],
    },
  },
)
