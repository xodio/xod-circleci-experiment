
function nullFunc() {}

var PULSE = {type: 'pulse'};

var identity = function(x) { return x; };

/* eslint-disable no-unused-vars */
function identityNode() {
  return {
     evaluate: function(e) { return {PIN: e.inputs.PIN}; }
  };
}

function startUpConstantNode() {
  return {
    setup: function(e) { e.fire({ value: e.props.value }); }
  };
}
/* eslint-enable no-unused-vars */

/**
  * @typedef {{
  *   lazy: boolean,
  *   nodeId: number,
  *   key: string
  * }} OutLink
  */
/**
  * @param {function} setup
  *   node’s setup function
  * @param {function} evaluate
  *   node’s evaluation function (aka implementation)
  * @param {boolean} pure
  *   whether `impl` should receive `fire` function as argument
  * @param {Object.<string, function>} inputTypes
  *   input type coercing functions
  * @param {Object.<string, Array.<OutLink>>} outLinks
  *   map from output name to outgoing link description
  * @param {Object.<number, Node>} nodes
  *   map from ID to `Node` instances
  */
function Node(args) {
  this._id = args.id;
  this._setup = args.setup || nullFunc;
  this._evaluate = args.evaluate || nullFunc;
  this._pure = (args.pure === undefined) ? true : args.pure;
  this._inputTypes = args.inputTypes || {};
  this._outLinks = args.outLinks || {};
  this._props = args.props || {};
  this._nodes = args.nodes;

  this._context = {};
  this._cachedInputs = {};
  this._pendingOutputs = {};
  this._dirty = false;
}

/**
  * Fires new signals at arbitrary point of time.
  *
  * The method is used by impure nodes to trigger external signals.
  * It is used by pure nodes as well but only in their setup to send
  * initial values.
  */
Node.prototype.fire = function(outputs) {
  var self = this;
  Object.keys(outputs).forEach(function(key) {
    self._pendingOutputs[key] = outputs[key];
  });

  this.emit('fire');
};

/**
  * Transaction start handler.
  *
  * It would be called from outside once before each transaction.
  */
Node.prototype.onTransactionStart = function() {
  this._sendOutputs(this._pendingOutputs);
  this._pendingOutputs = {};
};

/**
  * Returns whether any inputs were changed and node requires evaluation
  * in current transaction.
  */
Node.prototype.isDirty = function() {
  return this._dirty;
};

/**
  * Initializes the `Node`, sends initial signals.
  *
  * Called once the graph is ready at the very beginning of program execution.
  */
Node.prototype.setup = function() {
  this._setup({
    fire: this.fire.bind(this),
    props: this._props,
    context: this._context
  });
};

/**
  * Evaluates the `Node` taking input signals and producting output signals.
  */
Node.prototype.evaluate = function() {
  var fire, inputs, result, self;

  if (!this._dirty) {
    return;
  }

  fire = this._pure ? null : this.fire.bind(this);
  inputs = this._cachedInputs.clone();

  result = this._evaluate({
    inputs: inputs,
    fire: fire,
    context: this._context,
    props: this._props
  }) || {};

  // remove "outdated" pulses
  self = this;
  Object.keys(this._cachedInputs).forEach(function(key) {
    if (self._cachedInputs[key] === PULSE) {
      delete self._cachedInputs[key];
    }
  });

  this._sendOutputs(result);
  this._dirty = false;
};

Node.prototype._receiveInput = function(name, value, lazy) {
  this._cachedInputs[name] = this._inputTypes[name](value);
  this._dirty = this._dirty || !lazy;
};

Node.prototype._sendOutputs = function(signals) {
  var self = this;

  Object.keys(signals).forEach(function(outputName) {
    var val;
    var outLinks = self._outLinks[outputName];

    if (!outLinks) {
      return;
    }

    val = signals[outputName];
    outLinks.forEach(function(link) {
      self._nodes[link.nodeId]._receiveInput(link.key, val, !!link.lazy);
    });
  });
};

/**
  * @param {Object.<number, Node>} args.nodes
  *   map from ID to Node instances
  * @param {Array.<number, number>} args.topology
  *   sorted node index list that defines an order
  *   of the graph traversal
  */
function Project(args) {
  this._nodes = args.nodes;
  this._topology = args.topology;
  this._pendingTransaction = false;
  this._inTransaction = false;
}

/**
  * Setups all nodes all starts graph execution.
  */
Project.prototype.launch = function() {
  var fire = this.onNodeFire.bind(this);
  this.forEachNode(function(node) { node.on('fire', fire); });

  this._inSetup = true;

  try {
    this.forEachNode(function(node) { node.setup(); });
  } finally {
    this._inSetup = false;
  }

  this.flushTransaction();
};

/**
  * Starts a new transaction if required and possible.
  *
  * If ran it lead to cascade evaluation of all dirty nodes.
  */
Project.prototype.flushTransaction = function() {
  if (!this._pendingTransaction || this._inTransaction || this._inSetup) {
    return;
  }

  this._pendingTransaction = false;
  this._inTransaction = true;

  try {
    this.forEachNode(function(node) { node.onTransactionStart(); });
    this.forEachDirtyNode(function(node) { node.evaluate(); });
  } finally {
    this._inTransaction = false;
  }

  setTimeout(this.flushTransaction.bind(this), 0);
};

/**
  * Returns the first `Node` that should be evaluated according
  * to topological sort indexes. Returns `undefined` if all nodes
  * are up to date in current transaction.
  */
Project.prototype.getFirstDirtyNode = function() {
  var i, nodeId, node;
  var len = this._topology.length;
  for (i = 0; i < len; ++i) {
    nodeId = this._topology[i];
    node = this._nodes[nodeId];
    if (node.isDirty()) {
      return node;
    }
  }

  return null;
};

Project.prototype.forEachDirtyNode = function(callback) {
  var node;
  for (node = this.getFirstDirtyNode(); node; node = this.getFirstDirtyNode()) {
    callback(node);
  }
};

/**
  * Node fire handler.
  *
  * Gets called when any node uses `Node.fire` to issue an external signal
  * or an initial signal.
  */
Project.prototype.onNodeFire = function() {
  this._pendingTransaction = true;
  this.flushTransaction();
};

/**
  * Executes `callback` with `node` argument for every node in the graph.
  */
Project.prototype.forEachNode = function(callback) {
  var self = this;
  Object.keys(this._nodes).forEach(function(id) { callback(self._nodes[id]); });
};

if (typeof module !== 'undefined') {
  // Export some entities for tests
  module.exports.Node = Node;
  module.exports.Project = Project;
  module.exports.PULSE = PULSE;
  module.exports.identity = identity;
  module.exports.identityNode = identityNode;
  module.exports.startUpConstantNode = startUpConstantNode;
}