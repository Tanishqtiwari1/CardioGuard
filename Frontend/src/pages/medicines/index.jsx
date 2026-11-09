import { Route, Routes } from 'react-router-dom';
import '../sos.css';
import './medicines.css';
import Check from './Check';
import Detail from './Detail';
import Emergency from './Emergency';
import Health from './Health';
import Home from './Home';
import Prescription from './Prescription';
import Scan from './Scan';

// Loaded on demand so the rest of the app doesn't pay for this module.
export default function Medicines() {
  return <Routes>
    <Route index element={<Home />} />
    <Route path="scan" element={<Scan />} />
    <Route path="prescription" element={<Prescription />} />
    <Route path="check" element={<Check />} />
    <Route path="health" element={<Health />} />
    <Route path="emergency" element={<Emergency />} />
    <Route path=":id" element={<Detail />} />
  </Routes>;
}
