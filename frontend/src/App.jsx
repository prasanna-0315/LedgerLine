import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, getToken, setToken, newKey, inr } from './api.js';

const Auth = createContext(null);
const useAuth = () => useContext(Auth);
const Msg = ({ kind, children }) => (children ? <div className={`msg ${kind}`}>{children}</div> : null);

// The role check here only chooses what to SHOW. The backend enforces every permission.
function Guard({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/denied" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  useEffect(() => {
    if (!getToken()) return;
    api('GET', '/api/auth/profile').then(r => setUser(r.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);
  const logout = async () => { try { await api('POST', '/api/auth/logout'); } catch {} setToken(null); setUser(null); };
  return (
    <Auth.Provider value={{ user, setUser, loading }}>
      <header>
        <Link className="brand" to="/">LedgerLine</Link>
        {user ? (<>
          <Link to="/dashboard">Dashboard</Link><Link to="/accounts">Accounts</Link><Link to="/transactions">Transactions</Link>
          {user.role === 'ACCOUNT_HOLDER' && <><Link to="/deposit">Deposit</Link><Link to="/withdraw">Withdraw</Link><Link to="/transfer">Transfer</Link></>}
          {user.role === 'ADMIN' && <Link to="/admin/users">Users</Link>}
          {user.role !== 'ACCOUNT_HOLDER' && <Link to="/audit">Audit</Link>}
          <span>{user.name} ({user.role})</span><a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Log out</a>
        </>) : (<><Link to="/login">Log in</Link><Link to="/register">Register</Link></>)}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<AuthForm mode="login" />} />
          <Route path="/register" element={<AuthForm mode="register" />} />
          <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
          <Route path="/accounts" element={<Guard><Accounts /></Guard>} />
          <Route path="/accounts/:id" element={<Guard><AccountDetail /></Guard>} />
          <Route path="/deposit" element={<Guard roles={['ACCOUNT_HOLDER']}><MoneyForm kind="deposit" /></Guard>} />
          <Route path="/withdraw" element={<Guard roles={['ACCOUNT_HOLDER']}><MoneyForm kind="withdraw" /></Guard>} />
          <Route path="/transfer" element={<Guard roles={['ACCOUNT_HOLDER']}><MoneyForm kind="transfer" /></Guard>} />
          <Route path="/transactions" element={<Guard><Transactions /></Guard>} />
          <Route path="/admin/users" element={<Guard roles={['ADMIN']}><Users /></Guard>} />
          <Route path="/audit" element={<Guard roles={['ADMIN', 'AUDITOR']}><Audit /></Guard>} />
          <Route path="/denied" element={<div className="card"><h2>Access denied</h2><p>You do not have permission to view that page.</p></div>} />
          <Route path="*" element={<div className="card"><h2>Page not found</h2><Link to="/">Go home</Link></div>} />
        </Routes>
      </main>
    </Auth.Provider>
  );
}

function Landing() {
  return (<div className="card"><h1>Money movement with a ledger you can prove.</h1>
    <p>Double-entry accounting, idempotent payments, overdraft protection and an append-only audit trail.</p>
    <Link to="/register">Open an account</Link> · <Link to="/login">Log in</Link></div>);
}

function AuthForm({ mode }) {
  const { setUser } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'register') await api('POST', '/api/auth/register', f);
      const r = await api('POST', '/api/auth/login', { email: f.email, password: f.password });
      setToken(r.token); setUser(r.user); nav('/dashboard');
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (<form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
    <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
    {mode === 'register' && <label>Name<input required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>}
    <label>Email<input type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
    <label>Password<input type="password" required minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
    <Msg kind="err">{err}</Msg><button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}</button>
  </form>);
}

function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, err: '', loading: true });
  const reload = useCallback(() => { setState(s => ({ ...s, loading: true })); fn().then(data => setState({ data, err: '', loading: false })).catch(e => setState({ data: null, err: e.message, loading: false })); }, deps); // eslint-disable-line
  useEffect(reload, [reload]);
  return [state, reload];
}

function TxTable({ rows }) {
  if (!rows.length) return <p className="muted">No transactions yet.</p>;
  return (<table><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Amount</th><th>From</th><th>To</th><th>Reason</th><th>Date</th></tr></thead>
    <tbody>{rows.map(t => <tr key={t.id}><td>{t.id}</td><td>{t.type}</td><td>{t.status}</td><td>{inr(t.amount)}</td><td>{t.fromAccountId}</td><td>{t.toAccountId}</td><td>{t.refusalReason || ''}</td><td>{new Date(t.createdAt).toLocaleString()}</td></tr>)}</tbody></table>);
}

function Dashboard() {
  const { user } = useAuth();
  const [acc] = useLoad(() => api('GET', '/api/accounts'));
  const [tx] = useLoad(() => api('GET', '/api/transactions?limit=10'));
  const [integ] = useLoad(() => (user.role === 'ACCOUNT_HOLDER' ? Promise.resolve(null) : api('GET', '/api/admin/integrity')));
  const accounts = acc.data?.accounts || [];
  // Display-only sum of server-provided balances as cents-safe string math is done by the server per account.
  return (<>
    <h2>{user.role === 'ACCOUNT_HOLDER' ? 'My dashboard' : user.role === 'ADMIN' ? 'Admin dashboard' : 'Auditor dashboard (read-only)'}</h2>
    <Msg kind="err">{acc.err || tx.err}</Msg>
    {user.role === 'ACCOUNT_HOLDER' && <div className="card"><span className="muted">Accounts</span><div className="big">{accounts.length}</div>
      <p><Link to="/deposit">Deposit</Link> · <Link to="/withdraw">Withdraw</Link> · <Link to="/transfer">Transfer</Link></p></div>}
    {integ.data && <div className={`card`}><h3>System integrity</h3><p>Books balanced: <b>{integ.data.balanced ? 'YES' : 'NO'}</b> · {integ.data.transactions} transactions · debits {inr(integ.data.totalDebits)} = credits {inr(integ.data.totalCredits)}</p></div>}
    <div className="grid">{accounts.map(a => <Link key={a.id} to={`/accounts/${a.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="muted">#{a.id} {a.accountName} ({a.status})</div><div className="big">{inr(a.balance)}</div></Link>)}</div>
    {!acc.loading && !accounts.length && <p className="muted">No accounts yet. <Link to="/accounts">Create one</Link>.</p>}
    <div className="card"><h3>Recent transactions</h3>{tx.loading ? <p>Loading…</p> : <TxTable rows={tx.data?.transactions || []} />}</div>
  </>);
}

function Accounts() {
  const { user } = useAuth();
  const [acc, reload] = useLoad(() => api('GET', '/api/accounts'));
  const [name, setName] = useState(''); const [owner, setOwner] = useState(''); const [err, setErr] = useState('');
  const create = async (e) => { e.preventDefault(); setErr(''); try { await api('POST', '/api/accounts', { accountName: name, ...(user.role === 'ADMIN' ? { ownerId: Number(owner) } : {}) }); setName(''); reload(); } catch (x) { setErr(x.message); } };
  const setStatus = async (id, status) => { try { await api('PATCH', `/api/accounts/${id}/status`, { status }); reload(); } catch (x) { setErr(x.message); } };
  return (<>
    <h2>Accounts</h2><Msg kind="err">{acc.err || err}</Msg>
    {(user.role === 'ACCOUNT_HOLDER' || user.role === 'ADMIN') && <form className="card" onSubmit={create}><h3>Open an account</h3>
      <input required placeholder="Account name" value={name} onChange={e => setName(e.target.value)} />
      {user.role === 'ADMIN' && <input required type="number" min="1" placeholder="Owner user id" value={owner} onChange={e => setOwner(e.target.value)} />}
      <button>Create</button></form>}
    <div className="card">{acc.loading ? <p>Loading…</p> : !acc.data?.accounts.length ? <p className="muted">No accounts yet.</p> :
      <table><thead><tr><th>ID</th><th>Name</th><th>Owner</th><th>Balance</th><th>Status</th>{user.role === 'ADMIN' && <th>Admin</th>}</tr></thead>
        <tbody>{acc.data.accounts.map(a => <tr key={a.id}><td><Link to={`/accounts/${a.id}`}>{a.id}</Link></td><td>{a.accountName}</td><td>{a.ownerId}</td><td>{inr(a.balance)}</td><td>{a.status}</td>
          {user.role === 'ADMIN' && <td><select value={a.status} onChange={e => setStatus(a.id, e.target.value)}>{['ACTIVE', 'FROZEN', 'CLOSED'].map(s => <option key={s}>{s}</option>)}</select></td>}</tr>)}</tbody></table>}</div>
  </>);
}

function AccountDetail() {
  const { id } = useParams();
  const [d] = useLoad(() => api('GET', `/api/accounts/${id}/statement`), [id]);
  if (d.loading) return <p>Loading…</p>;
  if (d.err) return <Msg kind="err">{d.err}</Msg>;
  const { account, statement } = d.data;
  return (<>
    <h2>{account.accountName} <span className="muted">#{account.id}</span></h2>
    <div className="card"><span className="muted">Balance ({account.status})</span><div className="big">{inr(account.balance)}</div></div>
    <div className="card"><h3>Statement</h3>{!statement.length ? <p className="muted">No activity yet.</p> :
      <table><thead><tr><th>Date</th><th>Tx</th><th>Type</th><th>Status</th><th>Debit/Credit</th><th>Amount</th><th>Running balance</th><th>By</th><th>Reason</th></tr></thead>
        <tbody>{statement.map((r, i) => <tr key={i}><td>{new Date(r.date).toLocaleString()}</td><td>{r.transactionId}</td><td>{r.type}</td><td>{r.status}</td><td>{r.entryType || '—'}</td><td>{inr(r.amount)}</td><td>{r.balanceAfter ? inr(r.balanceAfter) : '—'}</td><td>{r.initiatedByName}</td><td>{r.refusalReason || ''}</td></tr>)}</tbody></table>}</div>
  </>);
}

function MoneyForm({ kind }) {
  const [acc] = useLoad(() => api('GET', '/api/accounts'));
  const [f, setF] = useState({ accountId: '', toAccountId: '', amount: '' });
  const [key, setKey] = useState(newKey()); // reused on retry so a double-click can never pay twice
  const [confirm, setConfirm] = useState(false); const [msg, setMsg] = useState({ k: '', t: '' }); const [busy, setBusy] = useState(false);
  const accounts = acc.data?.accounts || [];
  const submit = async () => {
    setBusy(true); setMsg({ k: '', t: '' });
    try {
      const body = kind === 'transfer' ? { fromAccountId: Number(f.accountId), toAccountId: Number(f.toAccountId), amount: f.amount } : { accountId: Number(f.accountId), amount: f.amount };
      const r = await api('POST', `/api/transactions/${kind}`, body, key);
      setMsg({ k: 'ok', t: `Done. Transaction #${r.transactionId}. New balance: ${inr(r.balance)}` }); setKey(newKey()); setF({ ...f, amount: '' });
    } catch (e) {
      setMsg({ k: 'err', t: e.message }); if (e.status && e.status !== 409) setKey(newKey()); // network/409: keep key and retry safely
    } finally { setBusy(false); setConfirm(false); }
  };
  const need = kind === 'transfer' ? f.accountId && f.toAccountId && f.amount : f.accountId && f.amount;
  return (<form className="card" style={{ maxWidth: 460 }} onSubmit={(e) => { e.preventDefault(); kind === 'deposit' ? submit() : setConfirm(true); }}>
    <h2 style={{ textTransform: 'capitalize' }}>{kind}</h2>
    <label>{kind === 'transfer' ? 'From account' : 'Account'}<select required value={f.accountId} onChange={e => setF({ ...f, accountId: e.target.value })}>
      <option value="">Select…</option>{accounts.map(a => <option key={a.id} value={a.id}>#{a.id} {a.accountName} — {inr(a.balance)}</option>)}</select></label>
    {kind === 'transfer' && <label>To account ID<input required type="number" min="1" value={f.toAccountId} onChange={e => setF({ ...f, toAccountId: e.target.value })} /></label>}
    <label>Amount (₹)<input required inputMode="decimal" pattern="\d{1,13}(\.\d{1,2})?" title="Positive amount, up to 2 decimals" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
    <Msg kind={msg.k}>{msg.t}</Msg><button disabled={busy || !need}>{busy ? 'Processing…' : `Submit ${kind}`}</button>
    {confirm && <div className="modal"><div className="card"><h3>Confirm {kind}</h3><p>{kind === 'transfer' ? `Transfer ${inr(f.amount)} to account #${f.toAccountId}?` : `Withdraw ${inr(f.amount)}?`}</p>
      <button type="button" disabled={busy} onClick={submit}>Confirm</button>{' '}<button type="button" className="secondary" onClick={() => setConfirm(false)}>Cancel</button></div></div>}
  </form>);
}

function Transactions() {
  const { user } = useAuth();
  const [t, reload] = useLoad(() => api('GET', '/api/transactions?limit=100'));
  const [msg, setMsg] = useState('');
  const reverse = async (id) => { try { await api('POST', `/api/transactions/${id}/reverse`, null, newKey()); setMsg(`Transaction ${id} reversed with compensating entries.`); reload(); } catch (e) { setMsg(e.message); } };
  return (<><h2>Transaction history</h2><Msg kind="err">{t.err}</Msg><Msg kind="ok">{msg}</Msg>
    <div className="card">{t.loading ? <p>Loading…</p> : <>
      <TxTable rows={t.data?.transactions || []} />
      {user.role === 'ADMIN' && <p className="muted">Reverse a completed transaction by ID: <input id="rid" style={{ width: 120 }} /> <button onClick={() => reverse(document.getElementById('rid').value)}>Reverse</button></p>}</>}</div></>);
}

function Users() {
  const [u, reload] = useLoad(() => api('GET', '/api/admin/users'));
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'AUDITOR' }); const [msg, setMsg] = useState('');
  const create = async (e) => { e.preventDefault(); try { await api('POST', '/api/admin/users', f); setF({ name: '', email: '', password: '', role: 'AUDITOR' }); setMsg(''); reload(); } catch (x) { setMsg(x.message); } };
  const patch = async (id, body) => { try { await api('PATCH', `/api/admin/users/${id}`, body); reload(); } catch (x) { setMsg(x.message); } };
  return (<><h2>User management</h2><Msg kind="err">{u.err || msg}</Msg>
    <form className="card" onSubmit={create}><h3>Create user (audited)</h3>
      <input required placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      <input required type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <input required type="password" minLength={8} placeholder="Temporary password (8+)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{['ACCOUNT_HOLDER', 'AUDITOR', 'ADMIN'].map(r => <option key={r}>{r}</option>)}</select><button>Create</button></form>
    <div className="card">{u.loading ? <p>Loading…</p> : <table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
      <tbody>{u.data.users.map(x => <tr key={x.id}><td>{x.id}</td><td>{x.name}</td><td>{x.email}</td>
        <td><select value={x.role} onChange={e => patch(x.id, { role: e.target.value })}>{['ACCOUNT_HOLDER', 'AUDITOR', 'ADMIN'].map(r => <option key={r}>{r}</option>)}</select></td>
        <td><button className="secondary" onClick={() => patch(x.id, { isActive: !x.isActive })}>{x.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table>}</div></>);
}

function Audit() {
  const [l] = useLoad(() => api('GET', '/api/admin/audit-logs'));
  const [i] = useLoad(() => api('GET', '/api/admin/integrity'));
  return (<><h2>Audit (read-only)</h2><Msg kind="err">{l.err || i.err}</Msg>
    {i.data && <div className="card"><h3>Ledger integrity</h3><p>Balanced: <b>{i.data.balanced ? 'YES' : 'NO'}</b> · balance sum {i.data.balanceSum} · debits {i.data.totalDebits} · credits {i.data.totalCredits} · mismatched accounts {i.data.mismatchedAccounts}</p></div>}
    <div className="card"><h3>Admin activity</h3>{l.loading ? <p>Loading…</p> : !l.data.logs.length ? <p className="muted">No audit events yet.</p> :
      <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{l.data.logs.map(x => <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString()}</td><td>{x.actorId}</td><td>{x.action}</td><td>{x.targetType} {x.targetId}</td><td>{JSON.stringify(x.metadata)}</td></tr>)}</tbody></table>}</div>
    <p className="muted">Auditors can also open any account's statement from the Accounts page, and see all transactions.</p></>);
}
