import { LocationProvider, Route, Router } from 'preact-iso';
import { AddChooser } from './routes/AddChooser';
import { AddConfirm, AddManual } from './routes/AddCard';
import { CardView } from './routes/CardView';
import { EditCard } from './routes/EditCard';
import { NotFound } from './routes/NotFound';
import { Settings } from './routes/Settings';
import { AddScan, RescanCard } from './routes/Scan';
import { Wallet } from './routes/Wallet';
import { UpdateToast } from './sw/update';

export function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Wallet} />
        <Route path="/add" component={AddChooser} />
        <Route path="/add/manual" component={AddManual} />
        <Route path="/add/scan" component={AddScan} />
        <Route path="/add/confirm" component={AddConfirm} />
        <Route path="/card/:id" component={CardView} />
        <Route path="/card/:id/edit" component={EditCard} />
        <Route path="/card/:id/rescan" component={RescanCard} />
        <Route path="/settings" component={Settings} />
        <Route default component={NotFound} />
      </Router>
      <UpdateToast />
    </LocationProvider>
  );
}
