import { Plugin } from '@opencode/plugin';
import { setupNativeTestPlugin } from '../src/testing';

export default Plugin.define({ id: 'carthagent', setup: setupNativeTestPlugin });
