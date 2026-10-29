import { render } from 'preact';
import { App } from './app';
import { startSyncTriggers } from './sync/triggers';
import './styles.css';

render(<App />, document.getElementById('app')!);
startSyncTriggers();
