export const namespaceYaml = `apiVersion: v1
kind: Namespace
metadata:
  name: assistant
`

export const deploymentYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant
  namespace: assistant
spec:
  replicas: 2
  selector:
    matchLabels:
      app: assistant
  template:
    metadata:
      labels:
        app: assistant
    spec:
      containers:
        - name: api
          image: acraksguided.azurecr.io/assistant:v1
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              value: training
`

export const serviceYaml = `apiVersion: v1
kind: Service
metadata:
  name: assistant
  namespace: assistant
spec:
  type: LoadBalancer
  selector:
    app: assistant
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
`
