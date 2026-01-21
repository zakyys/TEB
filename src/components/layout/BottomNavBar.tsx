import React from "react";
import { Home, ShoppingCart, Package, History, Settings, FileInput } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  path: string;
}

const BottomNavBar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const navItems: NavItem[] = [
    {
      icon: <Home size={22} />,
      label: "Home",
      path: "/",
    },
    {
      icon: <ShoppingCart size={22} />,
      label: "POS",
      path: "/pos",
    },
    {
      icon: <Package size={22} />,
      label: "Products",
      path: "/products",
    },
    {
      icon: <History size={22} />,
      label: "Tukar",
      path: "/history",
    },
    {
      icon: <Settings size={22} />,
      label: "Setting",
      path: "/profile",
    },
  ];

  const handleNavigation = (path: string) => {
    navigate(path);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border shadow-lg z-50">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item, index) => {
          const isActive = currentPath === item.path;
          return (
            <button
              key={index}
              className={`flex flex-col items-center justify-center w-full h-full transition-all duration-200 ${isActive ? "text-amber-500" : "text-muted-foreground"}`}
              onClick={() => handleNavigation(item.path)}
            >
              <div
                className={`transition-transform duration-300 ${isActive ? "scale-110" : "scale-100"}`}
              >
                {item.icon}
              </div>
              <span
                className={`text-xs mt-1 ${isActive ? "font-medium" : "font-normal"}`}
              >
                {item.label}
              </span>
              {isActive && (
                <div className="absolute bottom-0 w-10 h-1 bg-amber-500 rounded-t-md" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNavBar;
