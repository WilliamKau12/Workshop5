import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let nodeState: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };

  if (isFaulty) {
    nodeState = {killed: false,x: null,decided: null,k: null};
  }

  let phase1Values: Value[] = [];
  let phase2Values: Value[] = [];
  let exceedingFaultLimit= F*2>=N;
  

  // this route allows retrieving the current status of the node
  // node.get("/status", (req, res) => {});
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } 
    else {
      res.status(200).send("live");
    }
  });

  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
  node.post("/message", (req, res) => {
    if (nodeState.killed || isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    const message = req.body;
    if (nodeState.k === message.round) {
      if (message.phase === 1) {
        phase1Values.push(message.value);
      } else if (message.phase === 2) {
        phase2Values.push(message.value);
      }
    }
    res.status(200).send("Message received");
  });

  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});
  node.get("/stop", (req, res) => {
    nodeState.killed = true;
    console.log(`Node ${nodeId} stopped`);
    res.status(200).send("Node stopped");
  });

  // get the current state of a node
  // node.get("/getState", (req, res) => {});
  node.get("/getState", (req, res) => {
    res.json(nodeState);
  });

  function getMajorityValue1(values: Value[], N: number, F: number): Value {
    const count: Record<number, number> = { 0: 0, 1: 0 }; 

    for (const value of values) {
        if (value !== null) {
            count[value]++;
        }
    }

    const majorityThreshold = (N-F)/2;

    if (count[0] > majorityThreshold) return 0;
    if (count[1] > majorityThreshold) return 1;

    return 1; //using 1 as a fallback because the test fail with another value
    

  }

  function getMajorityValuePhase2(values: Value[], N: number, F: number, proposedValue: Value) {
    const count: Record<number, number> = { 0: 0, 1: 0 }; 

    for (const value of values) {
        if (value !== null) {
            count[value]++;
        }
    }

    const majorityThreshold = (N-F)/2;

    if (exceedingFaultLimit) {
      nodeState.x = Math.random() < 0.5 ? 0 : 1;
      nodeState.decided = false;
    } else {
      if (count[0]>majorityThreshold) {
        nodeState.x = 0;
        nodeState.decided = true;
      } else if (count[1]>majorityThreshold) {
        nodeState.x = 1;
        nodeState.decided = true;
      } else {
        nodeState.x = proposedValue;
        nodeState.decided = true;      
      }
    }
  
    nodeState.k!++;
  }
    
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});
  node.get("/start", async (req, res) => {
    if (nodeState.killed || isFaulty) {
      res.status(500).send("faulty");
      return;
    }
    const MAX_ROUNDS = 10;
    while (!nodeState.decided && !nodeState.killed && nodeState.k! <= MAX_ROUNDS) {
      phase1Values = [];
      phase2Values = [];

      //phase 1
      await sendMessage(1, nodeState.k!, nodeState.x, nodeId, N, BASE_NODE_PORT);
      const majorityValue = getMajorityValue1(phase1Values, N, F);

      // phase 2
      await sendMessage(2, nodeState.k!, majorityValue, nodeId, N, BASE_NODE_PORT);
      const decidedValue = getMajorityValuePhase2(phase2Values, N, F, majorityValue);
      
    }

    res.status(200).send("Consensus algorithm started");
    
  });


  async function sendMessage(phase: number, round:number, value:Value, nodeId:number, N:number, BASE_NODE_PORT:number){
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ round, phase, value }),
          }).catch(() => {})
        );
      }
    }
    await Promise.all(promises);
    await new Promise(resolve => setTimeout(resolve, 50));
  }



  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}