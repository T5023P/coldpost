import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Orders } from './pages/Orders';
import { OrderDetail } from './pages/OrderDetail';
import { Production } from './pages/Production';
import { Products } from './pages/Products';
import { Inventory } from './pages/Inventory';
import { Procurement } from './pages/Procurement';
import { PurchaseOrderDetail } from './pages/PurchaseOrderDetail';
import { Suppliers } from './pages/Suppliers';
import { SupplierDetail } from './pages/SupplierDetail';
import { Locations } from './pages/Locations';
import { Shipments } from './pages/Shipments';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { EmptyState, PageHead } from './components/ui';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted)' }}>
        <span className="spinner" /> Loading Cold Post…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/production" element={<Production />} />
        <Route path="/products" element={<Products />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/procurement" element={<Procurement />} />
        <Route path="/procurement/:id" element={<PurchaseOrderDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/shipments" element={<Shipments />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <>
              <PageHead title="Not found" subtitle="That page does not exist in Cold Post." />
              <div className="card">
                <EmptyState title="Nothing here" message="Use the navigation to get back to operations." />
              </div>
            </>
          }
        />
      </Routes>
    </Layout>
  );
}
