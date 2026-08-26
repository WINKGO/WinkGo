// Modified from AionUI by WINK GO contributors in 2026.
import type { IMcpServer } from '@/common/config/storage';
import React, { useEffect, useState } from 'react';
import JsonImportModal from './JsonImportModal';

interface AddMcpServerModalProps {
  visible: boolean;
  server?: IMcpServer;
  onCancel: () => void;
  onSubmit: (server: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => Promise<void> | void;
  onBatchImport?: (
    servers: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>[]
  ) => Promise<IMcpServer[] | void> | IMcpServer[] | void;
}

const AddMcpServerModal: React.FC<AddMcpServerModalProps> = ({
  visible,
  server,
  onCancel,
  onSubmit,
  onBatchImport,
}) => {
  const [showJsonModal, setShowJsonModal] = useState(false);

  useEffect(() => {
    if (visible && !server) {
      setShowJsonModal(true);
    } else if (visible && server) {
      setShowJsonModal(true);
    } else if (!visible) {
      setShowJsonModal(false);
    }
  }, [visible, server]);

  const handleModalCancel = () => {
    setShowJsonModal(false);
    onCancel();
  };

  if (!visible) return null;

  return (
    <JsonImportModal
      visible={showJsonModal}
      server={server}
      onCancel={handleModalCancel}
      onSubmit={onSubmit}
      onBatchImport={onBatchImport}
    />
  );
};

export default AddMcpServerModal;
