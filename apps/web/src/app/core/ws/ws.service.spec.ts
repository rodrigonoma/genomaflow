import { WsService } from './ws.service';

describe('WsService', () => {
  let service: WsService;
  let mockWs: any;

  beforeEach(() => {
    mockWs = {
      onopen: null, onmessage: null, onclose: null,
      close: jest.fn()
    };
    (global as any).WebSocket = jest.fn(() => mockWs);

    // NgZone passthrough — execução síncrona no run() é suficiente pra teste
    const fakeZone: any = { run: (fn: () => void) => fn() };
    service = new WsService(fakeZone);
  });

  it('opens WebSocket on connect', () => {
    service.connect('mytoken');
    expect(WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('/exams/subscribe?token=mytoken')
    );
  });

  it('emits examUpdates$ on message', (done) => {
    service.connect('tok');
    service.examUpdates$.subscribe(data => {
      expect(data.exam_id).toBe('abc');
      done();
    });
    mockWs.onmessage({ data: JSON.stringify({ exam_id: 'abc' }) });
  });

  it('does not reconnect after disconnect', () => {
    jest.useFakeTimers();
    service.connect('tok');
    service.disconnect();
    mockWs.onclose();
    jest.runAllTimers();
    expect(WebSocket).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
