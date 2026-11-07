import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import './styles.css';
import { SessionProvider } from './session';
import { ToastProvider } from './ui';
import { MessagesLayout, Conversation, Notifications } from './chat';
import { SiteLayout, Welcome, Services, Providers, ProviderDetail, NewConversation, RequestService, RequestSent, MyRequests, TrackRequest, More } from './customer';
import { Login, Signup, ProviderLayout, Dashboard, Requests, RequestDetail, ServicesPage, ProfilePage } from './provider';
import { AdminLayout, AdminDashboard, AdminCategories, AdminProviders, AdminRequests, AdminReports, AdminActivity, AdminSettings } from './admin';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SessionProvider><ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/provider/signup" element={<Signup />} />

          <Route element={<SiteLayout />}>
            <Route path="/" element={<Welcome />} />
            <Route path="/services" element={<Services />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/providers/:id" element={<ProviderDetail />} />
            <Route path="/providers/:id/request" element={<RequestService />} />
            <Route path="/request-sent/:ref" element={<RequestSent />} />
            <Route path="/messages" element={<CustomerMessages />}>
              <Route path=":id" element={<Conversation as="customer" base="/messages" />} />
            </Route>
            <Route path="/messages/new/:providerId" element={<NewConversation />} />
            <Route path="/requests" element={<MyRequests />} />
            <Route path="/track/:ref" element={<TrackRequest />} />
            <Route path="/notifications" element={<Notifications as="customer" backTo="/more" />} />
            <Route path="/more" element={<More />} />
          </Route>

          <Route element={<ProviderLayout />}>
            <Route path="/provider" element={<Dashboard />} />
            <Route path="/provider/requests" element={<Requests />} />
            <Route path="/provider/requests/:id" element={<RequestDetail />} />
            <Route path="/provider/messages" element={<MessagesLayout as="staff" base="/provider/messages" />}>
              <Route path=":id" element={<Conversation as="staff" base="/provider/messages" />} />
            </Route>
            <Route path="/provider/services" element={<ServicesPage />} />
            <Route path="/provider/profile" element={<ProfilePage />} />
            <Route path="/provider/notifications" element={<Notifications as="staff" backTo="/provider" />} />
          </Route>

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="providers" element={<AdminProviders />} />
            <Route path="requests" element={<AdminRequests />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="activity" element={<AdminActivity />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="notifications" element={<Notifications as="staff" backTo="/admin" />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider></SessionProvider>
  </StrictMode>
);

import { VerifyGate } from './verify';
function CustomerMessages() { return <VerifyGate title="Messages" reason="Verify your phone number to see your private messages."><MessagesLayout as="customer" base="/messages" /></VerifyGate>; }
