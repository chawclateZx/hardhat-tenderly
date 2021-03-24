import * as fs from "fs-extra";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { sep } from "path";

import { NetworkMap, PluginName } from "./index";
import { TenderlyService } from "./tenderly/TenderlyService";
import {
  ContractByName,
  Metadata,
  TenderlyArtifact,
  TenderlyContract,
  TenderlyContractUploadRequest
} from "./tenderly/types";
import { TenderlyNetwork } from "./TenderlyNetwork";
import { newCompilerConfig, resolveDependencies } from "./util";

export class Tenderly {
  public env: HardhatRuntimeEnvironment;
  public tenderlyNetwork: TenderlyNetwork;

  constructor(hre: HardhatRuntimeEnvironment) {
    this.env = hre;
    this.tenderlyNetwork = new TenderlyNetwork(hre);
  }

  public async verify(...contracts) {
    const flatContracts: ContractByName[] = contracts.reduce(
      (accumulator, value) => accumulator.concat(value),
      []
    );

    const requestData = await this.filterContracts(flatContracts);

    if (requestData == null) {
      console.log("Verification failed");
      return;
    }

    try {
      await TenderlyService.verifyContracts(requestData);
    } catch (err) {
      console.log(err.message);
    }
  }

  public network(): TenderlyNetwork {
    return this.tenderlyNetwork;
  }

  public async push(...contracts) {
    const flatContracts: ContractByName[] = contracts.reduce(
      (accumulator, value) => accumulator.concat(value),
      []
    );

    const requestData = await this.filterContracts(flatContracts);

    if (this.env.config.tenderly.project === undefined) {
      console.log(
        `Error in ${PluginName}: Please provide the project field in the tenderly object in hardhat.config.js`
      );
      return;
    }

    if (this.env.config.tenderly.username === undefined) {
      console.log(
        `Error in ${PluginName}: Please provide the username field in the tenderly object in hardhat.config.js`
      );
      return;
    }

    if (requestData == null) {
      console.log("Push failed");
      return;
    }

    try {
      await TenderlyService.pushContracts(
        requestData,
        this.env.config.tenderly.project,
        this.env.config.tenderly.username
      );
    } catch (err) {
      console.log(err.message);
    }
  }

  public async persistArtifacts(...contracts) {
    const sourcePaths = await this.env.run("compile:solidity:get-source-paths");
    const sourceNames = await this.env.run(
      "compile:solidity:get-source-names",
      { sourcePaths }
    );
    const data = await this.env.run("compile:solidity:get-dependency-graph", {
      sourceNames
    });

    let contract: ContractByName;
    const destPath = `deployments${sep}localhost_5777${sep}`;

    data._resolvedFiles.forEach((resolvedFile, _) => {
      const sourcePath: string = resolvedFile.sourceName;
      const name = sourcePath
        .split("/")
        .slice(-1)[0]
        .split(".")[0];

      for (contract of contracts) {
        if (contract.name === name) {
          const contractDataPath = `${this.env.config.paths.artifacts}${sep}${sourcePath}${sep}${name}.json`;
          const contractData = JSON.parse(
            fs.readFileSync(contractDataPath).toString()
          );

          const metadata: Metadata = {
            compiler: {
              version: this.env.config.solidity.compilers[0].version
            },
            sources: {
              [sourcePath]: {
                content: resolvedFile.content.rawContent
              }
            }
          };

          const visited: Record<string, boolean> = {};

          resolveDependencies(data, sourcePath, metadata, visited);

          const artifact: TenderlyArtifact = {
            metadata: JSON.stringify(metadata),
            address: contract.address,
            bytecode: contractData.bytecode,
            deployedBytecode: contractData.deployedBytecode,
            abi: contractData.abi
          };

          fs.outputFileSync(
            `${destPath}${name}.json`,
            JSON.stringify(artifact)
          );
        }
      }
    });
  }

  private async filterContracts(
    flatContracts: ContractByName[]
  ): Promise<TenderlyContractUploadRequest | null> {
    let contract: ContractByName;
    const requestData = await this.getContractData(flatContracts);

    for (contract of flatContracts) {
      const network =
        this.env.hardhatArguments.network !== "hardhat"
          ? this.env.hardhatArguments.network || contract.network
          : contract.network;
      if (network === undefined) {
        console.log(
          `Error in ${PluginName}: Please provide a network via the hardhat --network argument or directly in the contract`
        );
        return null;
      }

      const index = requestData.contracts.findIndex(
        requestContract => requestContract.contractName === contract.name
      );
      if (index === -1) {
        continue;
      }
      requestData.contracts[index].networks = {
        [NetworkMap[network.toLowerCase()]]: {
          address: contract.address
        }
      };
    }

    return requestData;
  }

  private async getContracts(
    flatContracts: ContractByName[]
  ): Promise<TenderlyContract[]> {
    const sourcePaths = await this.env.run("compile:solidity:get-source-paths");
    const sourceNames = await this.env.run(
      "compile:solidity:get-source-names",
      { sourcePaths }
    );
    const data = await this.env.run("compile:solidity:get-dependency-graph", {
      sourceNames
    });

    let contract: ContractByName;
    const requestContracts: TenderlyContract[] = [];
    const metadata: Metadata = {
      compiler: {
        version: this.env.config.solidity.compilers[0].version
      },
      sources: {}
    };

    data._resolvedFiles.forEach((resolvedFile, _) => {
      const sourcePath: string = resolvedFile.sourceName;
      const name = sourcePath
        .split("/")
        .slice(-1)[0]
        .split(".")[0];

      for (contract of flatContracts) {
        if (contract.name !== name) {
          continue;
        }

        metadata.sources[sourcePath] = {
          content: resolvedFile.content.rawContent
        };
        const visited: Record<string, boolean> = {};
        resolveDependencies(data, sourcePath, metadata, visited);
      }
    });

    for (const [key, value] of Object.entries(metadata.sources)) {
      const name = key
        .split("/")
        .slice(-1)[0]
        .split(".")[0];
      const contractToPush: TenderlyContract = {
        contractName: name,
        source: value.content,
        sourcePath: key,
        networks: {},
        compiler: {
          name: "solc",
          version: this.env.config.solidity?.compilers[0].version!
        }
      };
      requestContracts.push(contractToPush);
    }
    return requestContracts;
  }

  private async getContractData(
    flatContracts: ContractByName[]
  ): Promise<TenderlyContractUploadRequest> {
    const contracts = await this.getContracts(flatContracts);

    return {
      contracts,
      config: newCompilerConfig(this.env.config)
    };
  }
}
