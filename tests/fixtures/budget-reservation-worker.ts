import { parentPort, workerData } from "node:worker_threads";

import {
  BudgetLedger,
  type ReserveBudgetInput,
} from "../../src/main/budget-ledger";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";

interface ReservationWorkerData {
  databasePath: string;
  startSignal: SharedArrayBuffer;
  input: ReserveBudgetInput;
}

const port = parentPort;
if (port === null) throw new Error("budget worker requires a parent port");

const data = workerData as ReservationWorkerData;
const database = createSoarDatabase(data.databasePath);
const ledger = new BudgetLedger(new EventStore(database));
const signal = new Int32Array(data.startSignal);

port.postMessage({ type: "ready" });
Atomics.wait(signal, 0, 0);

try {
  const resolution = ledger.runImmediate((transaction) =>
    transaction.reserve(data.input),
  );
  port.postMessage({ type: "result", resolution });
} catch (error) {
  port.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  database.close();
}
