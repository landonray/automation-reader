import React from "react";
import { Link } from "react-router-dom";

interface Props {
  suite: any;
}

export function SuiteCard({ suite }: Props) {
  return (
    <Link to={`/suites/${suite.id}`} className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:shadow-sm transition-all">
      <div className="font-medium text-gray-900">{suite.name}</div>
      <div className="text-sm text-gray-500 mt-1">
        Created {new Date(suite.createdAt).toLocaleDateString()}
      </div>
    </Link>
  );
}
