import tkinter as tk
from gui.gui import AnomalyGUI

if __name__ == "__main__":
    root = tk.Tk()
    app = AnomalyGUI(root)
    root.mainloop()