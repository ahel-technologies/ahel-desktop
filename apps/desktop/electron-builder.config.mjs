/** electron-builder entry evaluated from the packaging environment; tests import the factory instead. */
import { createElectronBuilderConfig } from './scripts/electron-builder-config.mjs'

export { createElectronBuilderConfig }
export default createElectronBuilderConfig()
