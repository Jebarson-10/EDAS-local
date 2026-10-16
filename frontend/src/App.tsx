import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ExamWorkspacePage } from "./pages/ExamWorkspacePage";
import { ValidationPage } from "./pages/ValidationPage";
import { AuditPage } from "./pages/AuditPage";
import { BackupPage } from "./pages/BackupPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { AppProvider } from "./state/AppContext";

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<ExamWorkspacePage />} />
        <Route element={<AppShell />}>
          <Route path="/master" element={<Navigate to="/" replace />} />
          <Route path="/imports" element={<Navigate to="/" replace />} />
          <Route path="/cycles" element={<Navigate to="/" replace />} />
          <Route path="/theory" element={<Navigate to="/" replace />} />
          <Route path="/practical" element={<Navigate to="/" replace />} />
          <Route path="/hall" element={<Navigate to="/" replace />} />
          <Route path="/validation" element={<ValidationPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/backups" element={<BackupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/open-questions" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
