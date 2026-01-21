import React, { useEffect, useState } from "react";

type Printer = {
  name: string;
  id: string;
};

const PRINTER_KEY = "selectedPrinter";

const PrinterSettings: React.FC = () => {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(null);

  // Simulasi deteksi printer Bluetooth/Thermal
  const discoverPrinters = async () => {
    // Ganti dengan deteksi asli jika sudah ada library
    setPrinters([
      { name: "Thermal Printer 58mm", id: "thermal-58" },
      { name: "Bluetooth Printer TSC", id: "bt-tsc" },
    ]);
  };

  useEffect(() => {
    discoverPrinters();
    const saved = localStorage.getItem(PRINTER_KEY);
    if (saved) setSelectedPrinter(saved);
  }, []);

  const handleSelect = (id: string) => {
    setSelectedPrinter(id);
    localStorage.setItem(PRINTER_KEY, id);
  };

  return (
    <div style={{marginTop: 24, marginBottom: 24}}>
      <h3>Pengaturan Printer</h3>
      <ul>
        {printers.map((printer) => (
          <li key={printer.id}>
            <label>
              <input
                type="radio"
                name="printer"
                value={printer.id}
                checked={selectedPrinter === printer.id}
                onChange={() => handleSelect(printer.id)}
              />
              {printer.name}
            </label>
          </li>
        ))}
      </ul>
      {selectedPrinter && (
        <div>
          <strong>Printer terhubung:</strong>{" "}
          {printers.find((p) => p.id === selectedPrinter)?.name}
        </div>
      )}
    </div>
  );
};

export default PrinterSettings;