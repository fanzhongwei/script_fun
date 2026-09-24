FROM eclipse-temurin:21-jre
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY target/__SLUG__-*.jar app.jar
EXPOSE __PORT__
ENTRYPOINT ["java","-Duser.timezone=Asia/Shanghai","-jar","/app/app.jar"]
