import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { UploadPage } from './pages/UploadPage';
import { DashboardPage } from './pages/DashboardPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/dashboard/:uploadId" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
