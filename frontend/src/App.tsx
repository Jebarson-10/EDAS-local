import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { MasterDataPage } from "./pages/MasterDataPage";
import { ImportPage } from "./pages/ImportPage";
import { TheoryPage } from "./pages/TheoryPage";
import { PracticalPage } from "./pages/PracticalPage";
import { HallPage } from "./pages/HallPage";
import { ValidationPage } from "./pages/ValidationPage";
import { AuditPage } from "./pages/AuditPage";
import { BackupPage } from "./pages/BackupPage";
import { OpenQuestionsPage } from "./pages/OpenQuestionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ExamCyclePage } from "./pages/ExamCyclePage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { AppProvider } from "./state/AppContext";

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/master" element={<MasterDataPage />} />
          <Route path="/imports" element={<ImportPage />} />
          <Route path="/cycles" element={<ExamCyclePage />} />
          <Route path="/theory" element={<TheoryPage />} />
          <Route path="/practical" element={<PracticalPage />} />
          <Route path="/hall" element={<HallPage />} />
          <Route path="/validation" element={<ValidationPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/backups" element={<BackupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/open-questions" element={<OpenQuestionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
