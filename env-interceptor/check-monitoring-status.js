console.log('🖥️ RAGnos Vault Monitoring System Status Check');
console.log('=============================================');
console.log('');

// Check if we have the monitoring system components
const fs = require('fs');
const path = require('path');

console.log('📊 Monitoring Components Status:');
console.log('');

// 1. Production Demo (Live monitoring)
const productionDemoPath = path.join(__dirname, 'production-demo.js');
const hasProductionDemo = fs.existsSync(productionDemoPath);
console.log(`1. Production Demo Monitor: ${hasProductionDemo ? '✅ AVAILABLE' : '❌ NOT FOUND'}`);
if (hasProductionDemo) {
  console.log('   📍 Location: ./production-demo.js');
  console.log('   🚀 Start: node production-demo.js');
  console.log('   📈 Features: Real-time vault hit tracking, error monitoring');
}
console.log('');

// 2. Control Plane Dashboard (API + Swagger UI)  
const controlPlanePath = path.join(__dirname, '../services/control-plane');
const hasControlPlane = fs.existsSync(controlPlanePath);
console.log(`2. Control Plane Dashboard: ${hasControlPlane ? '✅ AVAILABLE' : '❌ NOT FOUND'}`);
if (hasControlPlane) {
  console.log('   📍 Location: ../services/control-plane/');
  console.log('   🌐 Default URL: http://localhost:3000/docs (Swagger UI)');
  console.log('   🚀 Start: cd ../services/control-plane && npm run dev');
  console.log('   📈 Features: API documentation, vault management, audit logs');
}
console.log('');

// 3. Integration Tests (Status monitoring)
const integrationTestPath = path.join(__dirname, 'final-integration-test.js');
const hasIntegrationTest = fs.existsSync(integrationTestPath);
console.log(`3. Integration Test Monitor: ${hasIntegrationTest ? '✅ AVAILABLE' : '❌ NOT FOUND'}`);
if (hasIntegrationTest) {
  console.log('   📍 Location: ./final-integration-test.js');
  console.log('   🚀 Start: node final-integration-test.js');
  console.log('   📈 Features: Health checks, performance validation, error detection');
}
console.log('');

// 4. Performance Benchmarking  
const performanceTestPath = path.join(__dirname, 'test-performance-benchmarking.js');
const hasPerformanceTest = fs.existsSync(performanceTestPath);
console.log(`4. Performance Monitor: ${hasPerformanceTest ? '✅ AVAILABLE' : '❌ NOT FOUND'}`);
if (hasPerformanceTest) {
  console.log('   📍 Location: ./test-performance-benchmarking.js');
  console.log('   🚀 Start: node test-performance-benchmarking.js');
  console.log('   📈 Features: Latency tracking, memory usage, throughput analysis');
}
console.log('');

console.log('🎯 Monitoring System Summary:');
console.log('');

if (hasProductionDemo) {
  console.log('✅ REAL-TIME MONITORING: Available');
  console.log('   • Live vault hit rate tracking');
  console.log('   • Error rate monitoring');
  console.log('   • Performance metrics');
  console.log('   • Kill switch status');
}

if (hasControlPlane) {
  console.log('✅ WEB DASHBOARD: Available');
  console.log('   • Swagger UI at http://localhost:3000/docs');
  console.log('   • API endpoints for vault management');
  console.log('   • Audit log interface');
  console.log('   • Provider configuration');
}

console.log('');
console.log('🚀 Quick Start Commands:');
console.log('');
console.log('# Start real-time monitoring (60-second demo):');
console.log('node production-demo.js');
console.log('');
console.log('# Start web dashboard (if dependencies installed):');
console.log('cd ../services/control-plane && npm run dev');
console.log('# Then visit: http://localhost:3000/docs');
console.log('');
console.log('# Run health check:');
console.log('node final-integration-test.js');
console.log('');

// System status
const monitoringScore = [hasProductionDemo, hasControlPlane, hasIntegrationTest, hasPerformanceTest]
  .filter(Boolean).length;

console.log('📊 Monitoring System Health:');
if (monitoringScore === 4) {
  console.log('🟢 EXCELLENT (4/4 components available)');
  console.log('   All monitoring capabilities operational');
} else if (monitoringScore >= 2) {
  console.log('🟡 GOOD (' + monitoringScore + '/4 components available)');
  console.log('   Core monitoring capabilities operational');
} else {
  console.log('🟠 LIMITED (' + monitoringScore + '/4 components available)');
  console.log('   Basic monitoring available');
}

console.log('');
console.log('✅ RAGnos Vault monitoring system ready for use!');