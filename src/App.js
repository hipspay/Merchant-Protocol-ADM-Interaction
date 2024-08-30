import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Button, Input, message, Spin, Select, Divider } from 'antd';
import ABI from './MerchantProtocolADM.json';

const { Option } = Select;

const CONTRACT_ADDRESS = "0x6B061bAe16E702c76C0D0537c8bf1928F2D7D2ec";
const MTO_TOKEN_ADDRESS = "0xE66b3AA360bB78468c00Bebe163630269DB3324F";

const TOKEN_OPTIONS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
};

// Standard ERC-20 ABI
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }, { "name": "_spender", "type": "address" }],
    "name": "allowance",
    "outputs": [{ "name": "remaining", "type": "uint256" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{ "name": "_spender", "type": "address" }, { "name": "_value", "type": "uint256" }],
    "name": "approve",
    "outputs": [{ "name": "success", "type": "bool" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "type": "function"
  }
];

export default function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [merchant, setMerchant] = useState('');
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [txId, setTxId] = useState('');
  const [mtoBalance, setMtoBalance] = useState('0');
  const [merchantReputation, setMerchantReputation] = useState({ reputation: 0, isValid: false });
  const [loading, setLoading] = useState(false);
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [mtoContract, setMtoContract] = useState(null);

  useEffect(() => {
    connectWallet();
  }, []);

  async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const providerInstance = new ethers.BrowserProvider(window.ethereum);
        const signerInstance = await providerInstance.getSigner();
        const address = await signerInstance.getAddress();

        setProvider(providerInstance);
        setSigner(signerInstance);
        setAccount(address);

        const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, ABI, signerInstance);
        setContract(contractInstance);

        const mtoContractInstance = new ethers.Contract(MTO_TOKEN_ADDRESS, ERC20_ABI, signerInstance);
        setMtoContract(mtoContractInstance);

        // Get MTO balance
        const balance = await mtoContractInstance.balanceOf(address);
        setMtoBalance(ethers.formatEther(balance));
      } catch (error) {
        console.error("Failed to connect wallet:", error);
        message.error("Failed to connect wallet. Please try again.");
      }
    } else {
      message.error("Please install MetaMask!");
    }
  }

  async function getTokenDecimals(tokenAddress) {
    if (!signer) return 6; // Default to 6 for USDC and USDT
    try {
      const tokenInstance = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const decimals = await tokenInstance.decimals();
      return decimals;
    } catch (error) {
      console.error("Failed to get token decimals:", error);
      return 6; // Default to 6 for USDC and USDT
    }
  }

  async function approveTokens(tokenInstance, amount) {
    try {
      setLoading(true);
      const gasLimit = await tokenInstance.approve.estimateGas(CONTRACT_ADDRESS, amount);
      const tx = await tokenInstance.approve(CONTRACT_ADDRESS, amount, { gasLimit });
      await tx.wait();
      message.success("Token approval successful!");
      return true;
    } catch (error) {
      console.error("Failed to approve tokens:", error);
      let errorMessage = "Failed to approve tokens. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function sendFunds() {
    if (!contract || !signer) return;

    try {
      setLoading(true);
      if (!merchant || !selectedToken || !amount) {
        message.error("Please fill out all fields.");
        return;
      }

      const tokenAddress = TOKEN_OPTIONS[selectedToken];
      const decimals = await getTokenDecimals(tokenAddress);
      setTokenDecimals(decimals);

      const parsedAmount = ethers.parseUnits(amount, decimals);
      console.log('Attempting to send funds with:', merchant, tokenAddress, parsedAmount.toString());

      const tokenInstance = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

      // Check allowance and approve if necessary
      const allowance = await tokenInstance.allowance(account, CONTRACT_ADDRESS);
      if (allowance < parsedAmount) {
        message.info("Insufficient token allowance. Requesting approval...");
        const approvalSuccess = await approveTokens(tokenInstance, parsedAmount);
        if (!approvalSuccess) return;
      }

      const contractWithSigner = contract.connect(signer);
      const estimatedGas = await contractWithSigner.sendFunds.estimateGas(merchant, tokenAddress, parsedAmount);
      console.log('Estimated gas:', estimatedGas.toString());

      const tx = await contractWithSigner.sendFunds(merchant, tokenAddress, parsedAmount, { gasLimit: estimatedGas });
      message.info("Transaction sent. Waiting for confirmation...");
      const receipt = await tx.wait();

      console.log("Transaction receipt:", receipt);

      let txIdFromEvent;
      if (receipt && receipt.logs) {
        for (const log of receipt.logs) {
          try {
            const parsedLog = contract.interface.parseLog(log);
            if (parsedLog.name === 'FundsSent') {
              txIdFromEvent = parsedLog.args.txId;
              break;
            }
          } catch (err) {
            console.error("Error parsing log:", err);
          }
        }
      }

      if (txIdFromEvent) {
        setTxId(txIdFromEvent);
        message.success("Funds sent successfully! Transaction ID: " + txIdFromEvent);
      } else {
        message.warning("Funds sent, but could not fetch transaction ID. Please check the transaction on the blockchain explorer.");
      }
    } catch (error) {
      console.error("Failed to send funds:", error);
      let errorMessage = "Failed to send funds. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function checkAndApproveMTO(amount) {
    if (!mtoContract || !signer) return false;

    try {
      const balance = await mtoContract.balanceOf(account);
      if (balance < amount) {
        message.error("Insufficient MTO balance. Please acquire more MTO tokens.");
        return false;
      }

      const allowance = await mtoContract.allowance(account, CONTRACT_ADDRESS);
      if (allowance < amount) {
        message.info("Insufficient MTO allowance. Requesting approval...");
        const approvalTx = await mtoContract.approve(CONTRACT_ADDRESS, amount);
        await approvalTx.wait();
        message.success("MTO approval successful!");
      }

      return true;
    } catch (error) {
      console.error("Failed to check or approve MTO:", error);
      message.error("Failed to check or approve MTO. Please try again.");
      return false;
    }
  }

  async function addProtection() {
    if (!contract || !signer || !txId) return;

    try {
      setLoading(true);

      // Get the PROTECTION_FEE from the contract
      const protectionFee = await contract.PROTECTION_FEE();

      // Check MTO balance and approve if necessary
      const mtoApproved = await checkAndApproveMTO(protectionFee);
      if (!mtoApproved) return;

      const contractWithSigner = contract.connect(signer);
      const tx = await contractWithSigner.addProtection(txId);
      await tx.wait();
      message.success("Protection added successfully!");
    } catch (error) {
      console.error("Failed to add protection:", error);
      let errorMessage = "Failed to add protection. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function checkTxStatus() {
    if (!contract || !txId) return;
    try {
      setLoading(true);
      const status = await contract.checkTxStatus(txId);
      const statusNames = ["NotFound", "NotProtected", "Protected", "Disputed", "Withdrawn", "Chargebacked"];
      message.info(`Transaction status: ${statusNames[status]}`);
    } catch (error) {
      console.error("Failed to check transaction status:", error);
      let errorMessage = "Failed to check transaction status. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function getMerchantReputation() {
    if (!contract || !merchant) return;
    try {
      setLoading(true);
      const result = await contract.calculateReputation(merchant);
      const reputation = ethers.toNumber(result[0]);
      const isValid = result[1];
      setMerchantReputation({ reputation, isValid });
      message.info(`Merchant reputation: ${reputation}, Valid: ${isValid}`);
    } catch (error) {
      console.error("Failed to get merchant reputation:", error);
      let errorMessage = "Failed to get merchant reputation. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function disputeTransaction() {
    if (!contract || !signer || !txId) return;

    try {
      setLoading(true);
      const contractWithSigner = contract.connect(signer);
      const tx = await contractWithSigner.dispute(txId);
      await tx.wait();
      message.success("Transaction disputed successfully!");
    } catch (error) {
      console.error("Failed to dispute transaction:", error);
      let errorMessage = "Failed to dispute transaction. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function withdraw() {
    if (!contract || !signer || !txId) return;

    try {
      setLoading(true);
      const contractWithSigner = contract.connect(signer);
      const tx = await contractWithSigner.withdraw(txId);
      await tx.wait();
      message.success("Withdrawal successful!");
    } catch (error) {
      console.error("Failed to withdraw:", error);
      let errorMessage = "Failed to withdraw. ";
      if (error.reason) {
        errorMessage += error.reason;
      } else if (error.message) {
        errorMessage += error.message;
      }
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
      <div style={{ padding: '20px' }}>
        <h1>MerchantProtocolADM Interaction</h1>
        {!account ? (
            <Button onClick={connectWallet}>Connect Wallet</Button>
        ) : (
            <div>
              <p>Connected Account: {account}</p>
              <p>MTO Balance: {mtoBalance} MTO</p>
            </div>
        )}
        <Input
            placeholder="Merchant Address"
            value={merchant}
            onChange={e => setMerchant(e.target.value)}
            style={{ marginTop: '10px' }}
        />
        <Select
            value={selectedToken}
            onChange={setSelectedToken}
            style={{ width: '100%', marginTop: '10px' }}
        >
          <Option value="USDC">USDC</Option>
          <Option value="USDT">USDT</Option>
        </Select>
        <Input
            placeholder="Amount"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ marginTop: '10px' }}
        />
        <Button onClick={sendFunds} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Send Funds'}
        </Button>
        <Input
            placeholder="Transaction ID"
            value={txId}
            onChange={e => setTxId(e.target.value)}
            style={{ marginTop: '10px' }}
        />
        <Button onClick={addProtection} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Add Protection'}
        </Button>
        <Button onClick={checkTxStatus} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Check Transaction Status'}
        </Button>
        <Button onClick={getMerchantReputation} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Get Merchant Reputation'}
        </Button>
        <Button onClick={disputeTransaction} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Dispute Transaction'}
        </Button>
        {merchantReputation.isValid && (
            <p>Merchant Reputation: {merchantReputation.reputation}</p>
        )}

        <Divider>Merchant Withdrawal</Divider>
        <Input
            placeholder="Transaction ID for Withdrawal"
            value={txId}
            onChange={e => setTxId(e.target.value)}
            style={{ marginTop: '10px' }}
        />
        <Button onClick={withdraw} disabled={loading} style={{ marginTop: '10px' }}>
          {loading ? <Spin /> : 'Withdraw'}
        </Button>
      </div>
  );
}