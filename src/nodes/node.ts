import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let messagesPhase1: { round: number; value: Value }[] = [];
  let messagesPhase2: { round: number; value: Value }[] = [];

  const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0
  };

  async function broadcast(phase: number, round: number, value: Value) {
    if (isFaulty || state.killed) return;
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: nodeId, phase, round, value })
          }).catch(() => {})
        );
      }
    }
    await Promise.all(promises);
  }

  async function benOrRound() {
    if (state.killed || isFaulty) return;
    await broadcast(1, state.k!, state.x!);
    await new Promise(resolve => setTimeout(resolve, 10));
    const phase1Messages = messagesPhase1.filter(m => m.round === state.k);
    const counts1 = { 0: 0, 1: 0 };
    phase1Messages.forEach(msg => {
      if (msg.value === 0 || msg.value === 1) {
        counts1[msg.value]++;
      }
    });
    let proposedValue: Value;
    const quorum = Math.floor((N + 1) / 2);
    if (counts1[1] >= quorum) {
      proposedValue = 1;
    } else if (counts1[0] >= quorum) {
      proposedValue = 0;
    } else {
      proposedValue = 1;
    }
    await broadcast(2, state.k!, proposedValue);
    await new Promise(resolve => setTimeout(resolve, 10));
    const phase2Messages = messagesPhase2.filter(m => m.round === state.k);
    const counts2 = { 0: 0, 1: 0 };
    phase2Messages.forEach(msg => {
      if (msg.value === 0 || msg.value === 1) {
        counts2[msg.value]++;
      }
    });
    const consensusThreshold = Math.ceil((N - F) / 2);
    if (F * 2 < N) {
      if (counts2[1] >= consensusThreshold) {
        state.x = 1;
        state.decided = true;
      } else if (counts2[0] >= consensusThreshold) {
        state.x = 0;
        state.decided = true;
      } else {
        state.x = proposedValue;
        state.decided = state.k! >= 1;
      }
    } else {
      state.x = proposedValue;
      state.decided = false;
    }
    state.k!++;
    if (!state.decided) {
      setTimeout(benOrRound, 10);
    }
  }

  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    const { phase, round, value } = req.body;
    if (typeof value === 'number' && (value === 0 || value === 1)) {
      if (phase === 1) {
        messagesPhase1.push({ round, value });
      } else if (phase === 2) {
        messagesPhase2.push({ round, value });
      }
    }
    res.json({ success: true });
  });

  node.get("/start", async (req, res) => {
    if (state.killed || isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    messagesPhase1 = [];
    messagesPhase2 = [];
    state.k = 0;
    state.decided = false;
    state.x = initialValue;
    setTimeout(benOrRound, 100);
    res.json({ success: true });
  });

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    res.send("live");
  });

  node.get("/stop", async (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    state.killed = true;
    state.decided = null;
    res.json({ success: true });
  });

  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.status(500).json({
        killed: null,
        x: null,
        decided: null,
        k: null
      });
      return;
    }
    res.json(state);
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });
  return server;
}
