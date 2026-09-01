/**
 * Unit tests for scanService.
 *
 * The DB is mocked so these run without a live PostgreSQL instance.
 * Tests cover: URL validation, module validation, createScan, getUserScans,
 * getScanById, and deleteScan.
 */

import {
  validateTargetUrl,
  validateModules,
  isPrivateOrLoopback,
  createScan,
  getUserScans,
  getScanById,
  deleteScan,
  startScan,
  stopScan,
  ValidationError,
  NotFoundError,
  ConflictError,
  ConcurrentLimitError,
  VALID_MODULES,
} from './scanService';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

// jest.mock factories are hoisted, so we build everything inside the factory.
// We expose helper references via special properties on the mock function.

jest.mock('../db', () => {
  // Shared query-chain methods. Every call to db('table') returns this object.
  const chain: Record<string, jest.Mock> = {
    where: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    select: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    count: jest.fn(),
    delete: jest.fn(),
    update: jest.fn().mockResolvedValue(1),
  };

  // trxFn is a callable function that also carries the same methods,
  // so inside a transaction the service can call trx('tableName').insert(...).
  function trxFn(/* tableName: string */) {
    return chain;
  }
  Object.assign(trxFn, chain);

  // The top-level db mock function
  function mockDbFn(/* tableName: string */) {
    return chain;
  }

  (mockDbFn as any).transaction = jest.fn(
    (cb: (trx: typeof trxFn) => Promise<unknown>) => cb(trxFn as any),
  );
  (mockDbFn as any).__chain = chain;
  (mockDbFn as any).__trxFn = trxFn;

  return {
    __esModule: true,
    default: mockDbFn,
    withId: <T>(payload: T): T => payload,
    withIds: <T>(payloads: T[]): T[] => payloads,
  };
});

jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./scanOrchestrator', () => ({
  runScan: jest.fn().mockResolvedValue(undefined),
  moduleRegistry: new Map(),
  requestStop: jest.fn(),
  isStopRequested: jest.fn().mockReturnValue(false),
  clearStopRequest: jest.fn(),
}));

// After jest.mock, import db and cast to the shape we know it has.
import db from '../db';

type ChainMock = {
  where: jest.Mock;
  whereNot: jest.Mock;
  first: jest.Mock;
  insert: jest.Mock;
  returning: jest.Mock;
  select: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  count: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
};

const mockDb = db as unknown as {
  transaction: jest.Mock;
  __chain: ChainMock;
  __trxFn: ChainMock & ((...args: unknown[]) => ChainMock);
};

// Convenience alias — re-assigned in beforeEach after jest.clearAllMocks().
let mockDbChain: ChainMock;
let mockTrxFn: ChainMock & ((...args: unknown[]) => ChainMock);

beforeEach(() => {
  jest.clearAllMocks();

  mockDbChain = mockDb.__chain;
  mockTrxFn = mockDb.__trxFn;

  // Restore default chaining behaviour after clearAllMocks resets mockReturnThis
  mockDbChain.where.mockReturnThis();
  mockDbChain.whereNot.mockReturnThis();
  mockDbChain.insert.mockReturnThis();
  mockDbChain.orderBy.mockReturnThis();
  mockDbChain.limit.mockReturnThis();
  mockDbChain.offset.mockReturnThis();

  // trxFn chain also needs to be restored (shares the same object but let's be safe)
  mockTrxFn.where.mockReturnThis();
  mockTrxFn.whereNot.mockReturnThis();
  mockTrxFn.insert.mockReturnThis();
  mockTrxFn.orderBy.mockReturnThis();
  mockTrxFn.limit.mockReturnThis();
  mockTrxFn.offset.mockReturnThis();
});

// ---------------------------------------------------------------------------
// isPrivateOrLoopback
// ---------------------------------------------------------------------------

describe('isPrivateOrLoopback', () => {
  it.each([
    ['localhost'],
    ['0.0.0.0'],
    ['127.0.0.1'],
    ['127.255.255.255'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.0.1'],
    ['192.168.255.255'],
    ['::1'],
    ['169.254.0.1'],
  ])('returns true for private/loopback: %s', (host) => {
    expect(isPrivateOrLoopback(host)).toBe(true);
  });

  it.each([
    ['example.com'],
    ['8.8.8.8'],
    ['172.15.0.1'],   // just outside 172.16-31 range
    ['172.32.0.1'],   // just outside 172.16-31 range
    ['11.0.0.1'],     // not in 10.x
    ['193.168.0.1'],  // not in 192.168.x
  ])('returns false for public address: %s', (host) => {
    expect(isPrivateOrLoopback(host)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateTargetUrl
// ---------------------------------------------------------------------------

describe('validateTargetUrl', () => {
  it('accepts a valid https URL', () => {
    expect(validateTargetUrl('https://example.com')).toBeNull();
  });

  it('accepts a valid http URL', () => {
    expect(validateTargetUrl('http://example.com/path?q=1')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(validateTargetUrl('')).not.toBeNull();
  });

  it('rejects a non-URL string', () => {
    expect(validateTargetUrl('not a url')).not.toBeNull();
  });

  it('rejects ftp:// scheme', () => {
    expect(validateTargetUrl('ftp://example.com')).not.toBeNull();
  });

  it('rejects mailto: scheme', () => {
    expect(validateTargetUrl('mailto:user@example.com')).not.toBeNull();
  });

  it('rejects localhost', () => {
    expect(validateTargetUrl('http://localhost:3000')).not.toBeNull();
  });

  it('rejects 127.0.0.1', () => {
    expect(validateTargetUrl('http://127.0.0.1')).not.toBeNull();
  });

  it('rejects RFC 1918 address 192.168.1.1', () => {
    expect(validateTargetUrl('http://192.168.1.1')).not.toBeNull();
  });

  it('rejects RFC 1918 address 10.0.0.1', () => {
    expect(validateTargetUrl('https://10.0.0.1/admin')).not.toBeNull();
  });

  it('rejects 172.16.x.x', () => {
    expect(validateTargetUrl('https://172.16.0.1')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateModules
// ---------------------------------------------------------------------------

describe('validateModules', () => {
  it('accepts a single valid module', () => {
    expect(validateModules(['http_headers'])).toBeNull();
  });

  it('accepts all valid modules', () => {
    expect(validateModules([...VALID_MODULES])).toBeNull();
  });

  it('rejects an empty array', () => {
    expect(validateModules([])).not.toBeNull();
  });

  it('rejects undefined', () => {
    expect(validateModules(undefined)).not.toBeNull();
  });

  it('rejects null', () => {
    expect(validateModules(null)).not.toBeNull();
  });

  it('rejects a non-array value', () => {
    expect(validateModules('http_headers')).not.toBeNull();
  });

  it('rejects an array with an invalid module name', () => {
    expect(validateModules(['http_headers', 'nmap_scan'])).not.toBeNull();
  });

  it('rejects an array containing a number', () => {
    expect(validateModules([42])).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createScan
// ---------------------------------------------------------------------------

const SCAN_ROW = {
  id: 'scan-uuid-001',
  target_url: 'https://example.com',
  status: 'pending',
  created_at: new Date('2024-01-15T10:00:00Z'),
};

describe('createScan', () => {
  describe('success path', () => {
    beforeEach(() => {
      // The service inserts the scan, fetches it, then inserts module rows.
      mockTrxFn.first.mockResolvedValue(SCAN_ROW);
      let insertCallCount = 0;
      mockTrxFn.insert.mockImplementation(() => {
        insertCallCount++;
        return insertCallCount === 1 ? Promise.resolve([]) : Promise.resolve([]);
      });
    });

    it('returns a scan object with status "pending"', async () => {
      const result = await createScan('user-1', {
        target_url: 'https://example.com',
        modules: ['http_headers', 'ssl_tls'],
      });

      expect(result.scan_id).toBe('scan-uuid-001');
      expect(result.status).toBe('pending');
      expect(result.target_url).toBe('https://example.com');
    });

    it('deduplicates modules before inserting', async () => {
      const insertedModules: string[] = [];
      let insertCallCount = 0;

      mockTrxFn.insert.mockImplementation((data: unknown) => {
        insertCallCount++;
        if (insertCallCount === 1) {
          // scans insert
          return Promise.resolve([]);
        }
        // scan_modules insert: data is array of module rows
        if (Array.isArray(data)) {
          (data as { module_name: string }[]).forEach((r) => insertedModules.push(r.module_name));
        }
        return Promise.resolve([]);
      });

      await createScan('user-1', {
        target_url: 'https://example.com',
        modules: ['http_headers', 'http_headers', 'ssl_tls'],
      });

      const httpHeadersOccurrences = insertedModules.filter((m) => m === 'http_headers').length;
      expect(httpHeadersOccurrences).toBe(1);
    });
  });

  describe('validation failures → ValidationError', () => {
    it('throws ValidationError for empty target_url', async () => {
      await expect(
        createScan('user-1', { target_url: '', modules: ['http_headers'] }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for non-http scheme', async () => {
      await expect(
        createScan('user-1', { target_url: 'ftp://example.com', modules: ['http_headers'] }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for localhost target', async () => {
      await expect(
        createScan('user-1', { target_url: 'http://localhost', modules: ['http_headers'] }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for RFC 1918 target', async () => {
      await expect(
        createScan('user-1', { target_url: 'http://192.168.1.1', modules: ['http_headers'] }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for empty modules array', async () => {
      await expect(
        createScan('user-1', { target_url: 'https://example.com', modules: [] }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for invalid module name', async () => {
      await expect(
        createScan('user-1', {
          target_url: 'https://example.com',
          modules: ['http_headers', 'invalid_module'],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('includes field errors for both invalid URL and invalid modules', async () => {
      try {
        await createScan('user-1', {
          target_url: 'ftp://bad',
          modules: [],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const e = err as ValidationError;
        const fields = e.errors.map((f) => f.field);
        expect(fields).toContain('target_url');
        expect(fields).toContain('modules');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getUserScans
// ---------------------------------------------------------------------------

const SCAN_LIST_ROWS = [
  {
    id: 'scan-001',
    target_url: 'https://example.com',
    status: 'completed',
    selected_modules: JSON.stringify(['http_headers']),
    progress_pct: 100,
    started_at: new Date('2024-01-10T10:00:00Z'),
    completed_at: new Date('2024-01-10T10:05:00Z'),
    created_at: new Date('2024-01-10T09:59:00Z'),
  },
  {
    id: 'scan-002',
    target_url: 'https://other.com',
    status: 'pending',
    selected_modules: JSON.stringify(['ssl_tls', 'port_scan']),
    progress_pct: 0,
    started_at: null,
    completed_at: null,
    created_at: new Date('2024-01-11T08:00:00Z'),
  },
];

describe('getUserScans', () => {
  beforeEach(() => {
    mockDbChain.count.mockResolvedValue([{ count: '2' }]);
    mockDbChain.select.mockResolvedValue(SCAN_LIST_ROWS);
  });

  it('returns paginated result with correct structure', async () => {
    const result = await getUserScans('user-1', { page: 1, perPage: 20 });

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(20);
    expect(result.total_pages).toBe(1);
    expect(result.data).toHaveLength(2);
  });

  it('maps db rows to ScanSummary objects', async () => {
    const result = await getUserScans('user-1', { page: 1, perPage: 20 });
    const first = result.data[0];

    expect(first.scan_id).toBe('scan-001');
    expect(first.target_url).toBe('https://example.com');
    expect(first.status).toBe('completed');
    expect(first.progress_pct).toBe(100);
    expect(first.selected_modules).toEqual(['http_headers']);
    expect(first.started_at).toBe('2024-01-10T10:00:00.000Z');
    expect(first.completed_at).toBe('2024-01-10T10:05:00.000Z');
  });

  it('handles null started_at and completed_at', async () => {
    const result = await getUserScans('user-1', { page: 1, perPage: 20 });
    const second = result.data[1];

    expect(second.started_at).toBeNull();
    expect(second.completed_at).toBeNull();
  });

  it('parses selected_modules from JSON string', async () => {
    const result = await getUserScans('user-1', { page: 1, perPage: 20 });
    expect(result.data[1].selected_modules).toEqual(['ssl_tls', 'port_scan']);
  });

  it('calculates total_pages correctly for partial last page', async () => {
    mockDbChain.count.mockResolvedValue([{ count: '3' }]);
    const result = await getUserScans('user-1', { page: 1, perPage: 2 });
    expect(result.total_pages).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getScanById
// ---------------------------------------------------------------------------

const FULL_SCAN_ROW = {
  id: 'scan-detail-001',
  target_url: 'https://target.com',
  status: 'running',
  selected_modules: JSON.stringify(['http_headers', 'ssl_tls']),
  progress_pct: 50,
  started_at: new Date('2024-01-12T10:00:00Z'),
  completed_at: null,
  created_at: new Date('2024-01-12T09:59:00Z'),
};

const MODULE_ROWS = [
  {
    id: 'mod-001',
    module_name: 'http_headers',
    status: 'completed',
    started_at: new Date('2024-01-12T10:00:05Z'),
    completed_at: new Date('2024-01-12T10:00:10Z'),
    error_message: null,
    created_at: new Date('2024-01-12T10:00:00Z'),
  },
  {
    id: 'mod-002',
    module_name: 'ssl_tls',
    status: 'running',
    started_at: new Date('2024-01-12T10:00:11Z'),
    completed_at: null,
    error_message: null,
    created_at: new Date('2024-01-12T10:00:00Z'),
  },
];

describe('getScanById', () => {
  describe('success path', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(FULL_SCAN_ROW);
      mockDbChain.select.mockResolvedValue(MODULE_ROWS);
    });

    it('returns scan detail with modules', async () => {
      const result = await getScanById('scan-detail-001', 'user-1');

      expect(result.scan_id).toBe('scan-detail-001');
      expect(result.target_url).toBe('https://target.com');
      expect(result.status).toBe('running');
      expect(result.progress_pct).toBe(50);
      expect(result.modules).toHaveLength(2);
    });

    it('maps module rows correctly', async () => {
      const result = await getScanById('scan-detail-001', 'user-1');
      const first = result.modules[0];

      expect(first.module_name).toBe('http_headers');
      expect(first.status).toBe('completed');
      expect(first.error_message).toBeNull();
    });

    it('handles null module completed_at', async () => {
      const result = await getScanById('scan-detail-001', 'user-1');
      const second = result.modules[1];

      expect(second.completed_at).toBeNull();
    });
  });

  describe('not found', () => {
    it('throws NotFoundError when scan does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);

      await expect(getScanById('missing-id', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when scan belongs to a different user', async () => {
      // DB returns undefined because where({ id, user_id }) found nothing
      mockDbChain.first.mockResolvedValue(undefined);

      await expect(getScanById('scan-detail-001', 'other-user')).rejects.toThrow(NotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// deleteScan
// ---------------------------------------------------------------------------

describe('deleteScan', () => {
  it('resolves when scan is "completed"', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'completed' });
    mockDbChain.delete.mockResolvedValue(1);

    await expect(deleteScan('scan-1', 'user-1')).resolves.toBeUndefined();
  });

  it('resolves when scan is "stopped"', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'stopped' });
    mockDbChain.delete.mockResolvedValue(1);

    await expect(deleteScan('scan-1', 'user-1')).resolves.toBeUndefined();
  });

  it('resolves when scan is "failed"', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'failed' });
    mockDbChain.delete.mockResolvedValue(1);

    await expect(deleteScan('scan-1', 'user-1')).resolves.toBeUndefined();
  });

  it('throws ConflictError when scan is "running"', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'running' });

    await expect(deleteScan('scan-1', 'user-1')).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when scan is "pending"', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'pending' });

    await expect(deleteScan('scan-1', 'user-1')).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError when scan does not exist', async () => {
    mockDbChain.first.mockResolvedValue(undefined);

    await expect(deleteScan('missing-scan', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when scan belongs to another user', async () => {
    mockDbChain.first.mockResolvedValue(undefined);

    await expect(deleteScan('scan-1', 'other-user')).rejects.toThrow(NotFoundError);
  });

  it('ConflictError message mentions the scan status', async () => {
    mockDbChain.first.mockResolvedValue({ id: 'scan-1', status: 'running' });

    try {
      await deleteScan('scan-1', 'user-1');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toContain('running');
    }
  });
});

// ---------------------------------------------------------------------------
// startScan
// ---------------------------------------------------------------------------

const PENDING_SCAN_ROW = {
  id: 'scan-start-001',
  target_url: 'https://example.com',
  status: 'pending',
  selected_modules: JSON.stringify(['http_headers', 'ssl_tls']),
};

describe('startScan', () => {
  describe('success path — pending scan, no concurrency conflict', () => {
    beforeEach(() => {
      // scan fetch → pending scan
      mockDbChain.first.mockResolvedValue(PENDING_SCAN_ROW);
      // concurrent running count → 0
      mockDbChain.count.mockResolvedValue([{ count: '0' }]);
      // update resolves
      mockDbChain.update.mockResolvedValue(1);
    });

    it('returns { scan_id, status: "running" }', async () => {
      const result = await startScan('scan-start-001', 'user-1');
      expect(result.scan_id).toBe('scan-start-001');
      expect(result.status).toBe('running');
    });

    it('calls db update to set status to "running"', async () => {
      await startScan('scan-start-001', 'user-1');
      expect(mockDbChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' }),
      );
    });
  });

  describe('not found', () => {
    it('throws NotFoundError when scan does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(startScan('missing-scan', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when scan belongs to another user', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(startScan('scan-start-001', 'other-user')).rejects.toThrow(NotFoundError);
    });
  });

  describe('conflict — scan not in pending status', () => {
    it('throws ConflictError when scan is "running"', async () => {
      mockDbChain.first.mockResolvedValue({ ...PENDING_SCAN_ROW, status: 'running' });
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "completed"', async () => {
      mockDbChain.first.mockResolvedValue({ ...PENDING_SCAN_ROW, status: 'completed' });
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "stopped"', async () => {
      mockDbChain.first.mockResolvedValue({ ...PENDING_SCAN_ROW, status: 'stopped' });
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "failed"', async () => {
      mockDbChain.first.mockResolvedValue({ ...PENDING_SCAN_ROW, status: 'failed' });
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('ConflictError message mentions the current status', async () => {
      mockDbChain.first.mockResolvedValue({ ...PENDING_SCAN_ROW, status: 'completed' });
      try {
        await startScan('scan-start-001', 'user-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        expect((err as ConflictError).message).toContain('completed');
      }
    });
  });

  describe('concurrent limit — user already has 3 running scans', () => {
    beforeEach(() => {
      // Scan exists and is pending
      mockDbChain.first.mockResolvedValue(PENDING_SCAN_ROW);
    });

    it('throws ConcurrentLimitError when count is exactly 3', async () => {
      mockDbChain.count.mockResolvedValue([{ count: '3' }]);
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConcurrentLimitError);
    });

    it('throws ConcurrentLimitError when count is greater than 3', async () => {
      mockDbChain.count.mockResolvedValue([{ count: '5' }]);
      await expect(startScan('scan-start-001', 'user-1')).rejects.toThrow(ConcurrentLimitError);
    });

    it('does NOT throw ConcurrentLimitError when count is 2', async () => {
      mockDbChain.count.mockResolvedValue([{ count: '2' }]);
      mockDbChain.update.mockResolvedValue(1);
      await expect(startScan('scan-start-001', 'user-1')).resolves.toBeDefined();
    });

    it('ConcurrentLimitError message mentions the limit', async () => {
      mockDbChain.count.mockResolvedValue([{ count: '3' }]);
      try {
        await startScan('scan-start-001', 'user-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ConcurrentLimitError);
        expect((err as ConcurrentLimitError).message).toMatch(/3/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// stopScan
// ---------------------------------------------------------------------------

const RUNNING_SCAN_ROW = {
  id: 'scan-stop-001',
  status: 'running',
};

describe('stopScan', () => {
  describe('success path — running scan', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(RUNNING_SCAN_ROW);
      mockDbChain.update.mockResolvedValue(1);
    });

    it('returns { scan_id, status: "stopped" }', async () => {
      const result = await stopScan('scan-stop-001', 'user-1');
      expect(result.scan_id).toBe('scan-stop-001');
      expect(result.status).toBe('stopped');
    });

    it('calls db update to set status to "stopped"', async () => {
      await stopScan('scan-stop-001', 'user-1');
      expect(mockDbChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'stopped' }),
      );
    });
  });

  describe('not found', () => {
    it('throws NotFoundError when scan does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(stopScan('missing-scan', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when scan belongs to another user', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(stopScan('scan-stop-001', 'other-user')).rejects.toThrow(NotFoundError);
    });
  });

  describe('conflict — scan not in running status', () => {
    it('throws ConflictError when scan is "pending"', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'scan-stop-001', status: 'pending' });
      await expect(stopScan('scan-stop-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "completed"', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'scan-stop-001', status: 'completed' });
      await expect(stopScan('scan-stop-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "stopped"', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'scan-stop-001', status: 'stopped' });
      await expect(stopScan('scan-stop-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when scan is "failed"', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'scan-stop-001', status: 'failed' });
      await expect(stopScan('scan-stop-001', 'user-1')).rejects.toThrow(ConflictError);
    });

    it('ConflictError message mentions the current status', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'scan-stop-001', status: 'pending' });
      try {
        await stopScan('scan-stop-001', 'user-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        expect((err as ConflictError).message).toContain('pending');
      }
    });
  });
});
