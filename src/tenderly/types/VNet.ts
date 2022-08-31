export interface VNet {
  vnet_id: string;
  root_tx_id: string;
  chain_config?: Record<string, string>;
}

export interface VNetTransaction {
  id: string;
  project_id: string;
  fork_id: string;
  state_objects: StateObject[];
}

export interface StateObject {
  address: string;
  data: Record<string, string>;
}