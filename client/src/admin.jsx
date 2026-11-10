export function AdminBlockchain() {
  const { data, loading, error } = useAsync(() => api('/admin/blockchain/explorer', { as: 'staff' }), []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <>
      <h1>Blockchain Explorer</h1>
      <p className="muted small">Live view of the FSP Chain network and recent transactions.</p>
      
      <Alert>{error}</Alert>

      <div className="cols">
        <div className="kpi">
          <b>{data.network.height}</b>
          <span>Current Block Height</span>
        </div>
        <div className="kpi">
          <b>3</b> {/* Changed from 4 to 3 */}
          <span>Active Validators</span>
        </div>
      </div>

      <h2>Network Status</h2>
      <Table head={['Node', 'Status', 'Latest Hash']}>
        <tr>
          <td>Node 1 (Leader)</td>
          <td><Pill kind="active">Synced</Pill></td>
          <td className="small muted" style={{ wordBreak: 'break-all' }}>
            {data.network.latestHash}
          </td>
        </tr>
      </Table>

      <h2>Recent Transactions (Outbox)</h2>
      <Table head={['Tx ID', 'Event Type', 'Status', 'Created', 'Confirmed']}>
        {data.transactions.map((tx) => (
          <tr key={tx.transaction_id}>
            <td className="small muted" style={{ maxWidth: '150px', wordBreak: 'break-all' }}>
              {tx.transaction_id}
            </td>
            <td><b>{tx.event_type}</b></td>
            <td>
              <Pill kind={tx.submission_status === 'CONFIRMED' ? 'completed' : 'pending'}>
                {tx.submission_status}
              </Pill>
            </td>
            <td className="small muted">{when(tx.created_at)}</td>
            <td className="small muted">{tx.confirmed_at ? when(tx.confirmed_at) : '-'}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}